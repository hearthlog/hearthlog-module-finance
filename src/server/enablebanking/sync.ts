/**
 * One fetch of every account an approval shares: the balance the bank states now and the booked rows since a week
 * before the last booked day (the first fetch asks for as far back as the bank gives). Balances and rows become the
 * same entities the mail provider writes: one asset per account, named by its account number so a renewed approval
 * keeps it, and one done, unreviewed row per booked entry. Pending entries stay out of the ledger until booked.
 *
 * The bank's answers become the connection's state: a rate limit waits six hours (fetches while the user is present
 * still work), an ended approval stops the sync and freezes the balances.
 */

import { addHours, format, parseISO, subDays } from 'date-fns';
import type { ServerIntegration } from '@hearthlog/sdk/server';
import { assetIdFor, connectionIdFor, transactionIdFor } from '../../finance/bank-ids.js';
import type { EbSession, EbStateStore } from '../bank-state.js';
import { upsert } from '../bank-email.js';
import { ebCall, EbError, type EbConfig, type PsuHeaders } from './client.js';
import { chooseBalance, toFinanceRow, type EbBalance, type EbTransaction } from './map.js';
import type { RateLookup } from './rates.js';

export const BACKGROUND_EVERY_HOURS = 6;
export const PRESENT_EVERY_MINUTES = 5;
const round2 = (n: number) => Math.round(n * 100) / 100;

export interface SyncContext {
    integration: ServerIntegration;
    session: EbSession;
    config: EbConfig;
    store: EbStateStore;
    rates: RateLookup;
    now: number;
    /** Present when the user asked (refresh, opening Finance); absent for the background fetch. */
    psu?: PsuHeaders;
}

export type SyncOutcome =
    | { status: 'synced'; rows: number }
    | { status: 'rate_limited'; nextTryAt: string }
    | { status: 'expired' }
    | { status: 'error'; message: string }
    | { status: 'skipped'; reason: string };

/** Every page of an account's booked rows. */
async function bookedRows(context: SyncContext, uid: string, dateFrom: string | null): Promise<EbTransaction[]> {
    const rows: EbTransaction[] = [];
    let continuationKey: string | undefined;
    for (let page = 0; page < 50; page++) {
        const body = await ebCall<{ transactions?: EbTransaction[]; continuation_key?: string | null }>(context.config, 'GET', `/accounts/${encodeURIComponent(uid)}/transactions`, {
            query: { date_from: dateFrom ?? undefined, strategy: dateFrom ? undefined : 'longest', transaction_status: 'BOOK', continuation_key: continuationKey },
            psu: context.psu,
            now: context.now,
        });
        rows.push(...(body.transactions ?? []));
        continuationKey = body.continuation_key ?? undefined;
        if (!continuationKey) break;
    }
    return rows;
}

async function writeConnection(context: SyncContext, fields: Record<string, unknown>): Promise<void> {
    const { integration, session, now } = context;
    const id = await connectionIdFor(integration.id, session.bank);
    const key = `eb-sync:${now}`;
    await upsert(integration, 'bank_connection', id, key, now, (base) => base === undefined
        ? { type: 'BANK_CONNECTION_ADDED', payload: { bank: session.bank, provider: 'enable_banking', country: 'CZ', valid_until: session.validUntil, status: 'active', last_error: '', ...fields } }
        : { type: 'BANK_CONNECTION_UPDATED', payload: fields });
}

export async function syncSession(context: SyncContext): Promise<SyncOutcome> {
    const { integration, now, store } = context;
    const session = structuredClone(context.session);
    const nowIso = new Date(now).toISOString();
    if (session.status === 'expired' || Date.parse(session.validUntil) <= now) {
        if (session.status !== 'expired') {
            session.status = 'expired';
            await store.putSession(session);
            await writeConnection(context, { status: 'expired' });
        }
        return { status: 'expired' };
    }
    const mailKey = `eb-sync:${now}`;
    const connectionId = await connectionIdFor(integration.id, session.bank);
    let written = 0;
    try {
        for (const account of session.accounts) {
            const { balances = [] } = await ebCall<{ balances?: EbBalance[] }>(context.config, 'GET', `/accounts/${encodeURIComponent(account.uid)}/balances`, { psu: context.psu, now });
            const chosen = chooseBalance(balances).chosen;
            const currency = (chosen?.currency ?? account.currency ?? 'CZK').toUpperCase();
            const rate = await context.rates(currency);
            const assetId = await assetIdFor(integration.id, account.key);
            if (chosen && Number.isFinite(chosen.amount) && rate !== null) {
                const amount = round2(chosen.amount * rate);
                const native = currency === 'CZK' ? {} : { native_amount: chosen.amount };
                await upsert(integration, 'asset', assetId, mailKey, now, (base) => base === undefined
                    ? {
                        type: 'ASSET_ADDED',
                        payload: {
                            name: account.name, amount, asset_type: 'asset', link: 'bank', provider: 'enable_banking',
                            connection_id: connectionId, account_hash: account.key, account_kind: 'current',
                            currency, balance_type: chosen.type, balance_source: 'bank', synced_at: nowIso, ...native,
                        },
                    }
                    : { type: 'ASSET_UPDATED', payload: { amount, balance_type: chosen.type, synced_at: nowIso, ...native } });
            }

            const since = session.lastBooked[account.key];
            const dateFrom = since ? format(subDays(parseISO(since), 7), 'yyyy-MM-dd') : null;
            for (const entry of await bookedRows(context, account.uid, dateFrom)) {
                const row = toFinanceRow(entry);
                if (!row.booked || !row.bank_ref || !row.date || !Number.isFinite(row.amount)) continue;
                const rowCurrency = (row.currency ?? currency).toUpperCase();
                const rowRate = rowCurrency === currency ? rate : await context.rates(rowCurrency);
                if (rowRate === null) continue;
                const transactionId = await transactionIdFor(account.key, `eb:${row.bank_ref}`);
                const foreign = rowCurrency === 'CZK' ? {} : { native_amount: row.amount, native_currency: rowCurrency };
                await upsert(integration, 'transaction', transactionId, mailKey, now, (base) => base === undefined
                    ? {
                        type: 'TRANSACTION_ADDED',
                        payload: {
                            name: row.name, amount: round2(row.amount * rowRate), due_date: row.date, transaction_status: 'archived',
                            transaction_category: 'unknown', category_source: '', asset_id: assetId, bank_ref: `eb:${row.bank_ref}`,
                            bank_text: (row.bank_text ?? '').slice(0, 500), counterparty: (row.counterparty ?? '').slice(0, 300), review: 'new', ...foreign,
                        },
                    }
                    : { type: 'TRANSACTION_UPDATED', payload: { bank_text: (row.bank_text ?? '').slice(0, 500) } });
                written += 1;
                if (!session.lastBooked[account.key] || row.date > session.lastBooked[account.key]!) session.lastBooked[account.key] = row.date;
            }
        }
    } catch (error) {
        if (!(error instanceof EbError)) throw error;
        if (error.code === 'ASPSP_RATE_LIMIT_EXCEEDED') {
            const nextTryAt = addHours(now, BACKGROUND_EVERY_HOURS).toISOString();
            session.nextTryAt = nextTryAt;
            await store.putSession(session);
            await writeConnection(context, { status: 'rate_limited', next_try_at: nextTryAt });
            return { status: 'rate_limited', nextTryAt };
        }
        if (error.code === 'EXPIRED_SESSION' || error.code === 'REVOKED_SESSION' || error.code === 'CLOSED_SESSION') {
            session.status = 'expired';
            await store.putSession(session);
            await writeConnection(context, { status: error.code === 'REVOKED_SESSION' ? 'revoked' : 'expired' });
            return { status: 'expired' };
        }
        await writeConnection(context, { status: 'error', last_error: error.message.slice(0, 200) });
        return { status: 'error', message: error.message };
    }

    if (context.psu) session.lastPresentAt = nowIso;
    else session.lastBackgroundAt = nowIso;
    session.nextTryAt = null;
    await store.putSession(session);
    await writeConnection(context, { status: 'active', last_sync_at: nowIso, last_error: '', next_try_at: '', valid_until: session.validUntil });
    return { status: 'synced', rows: written };
}

/** Whether the hourly job should fetch this approval now: active, past any rate limit, six hours since the last one. */
export function backgroundDue(session: EbSession, now: number): boolean {
    if (session.status !== 'active') return false;
    // Past its end date: one more run marks it expired and stops.
    if (Date.parse(session.validUntil) <= now) return true;
    if (session.nextTryAt && Date.parse(session.nextTryAt) > now) return false;
    return !session.lastBackgroundAt || now - Date.parse(session.lastBackgroundAt) >= BACKGROUND_EVERY_HOURS * 3_600_000;
}

/** Whether a fetch the user asked for may run: at most one per five minutes. */
export function presentAllowed(session: EbSession, now: number): boolean {
    return session.status === 'active' && (!session.lastPresentAt || now - Date.parse(session.lastPresentAt) >= PRESENT_EVERY_MINUTES * 60_000);
}
