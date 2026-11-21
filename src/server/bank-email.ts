/**
 * A forwarded bank mail becomes ledger entities, authored by the mail integration:
 *
 * - the bank's connection (one per bank and forwarding address),
 * - the linked account, named by the normalised account number, with the balance the mail states (or, for a bank
 *   that states none, the last one plus this payment),
 * - the payment as a done, unreviewed transaction.
 *
 * Every id is derived from what the mail says, so a mail delivered twice, or a payment already imported from a
 * statement, lands on the same entity. When a stated balance does not follow from the last one plus this payment, a
 * mail went missing: the bank's figure still wins, and the gap is put on the account for the user to explain.
 * Anything Finance cannot read is kept as a `bank_mail` for the user to look at, never guessed.
 */

import type { EmailRequest, ServerIntegration, ServiceAppend } from '@hearthlog/sdk/server';
import { normalizeAccount } from '../finance/account-keys.js';
import { assetIdFor, bankRefFor, connectionIdFor, stableUuid as deterministicUuid, transactionIdFor } from '../finance/bank-ids.js';
import { BANK_LIST, type BankInfo } from '../finance/banks.js';
import type { ParsedEmail } from '../finance/bank-parsers/types.js';
import type { BankStateStore } from './bank-state.js';
import { readMail, type MailReading, type ReadOptions } from './mail/read-mail.js';

export interface BankMailContext {
    integration: ServerIntegration;
    raw: Uint8Array;
    now: number;
    store: BankStateStore;
    /** The site's mail subdomain, to record the forwarding address on a new connection; empty when not set. */
    mailDomain: string;
    reject: EmailRequest['reject'];
    read?: ReadOptions;
}

export type BankMailOutcome =
    | { kind: 'payment'; transactionId: string; assetId: string; gap: number }
    | { kind: 'duplicate' }
    | { kind: 'set-aside'; mailId: string; reason: string };

const round2 = (n: number) => Math.round(n * 100) / 100;

export function bankOfParser(bankName: string): BankInfo | null {
    return BANK_LIST.find((bank) => bank.name === bankName) ?? null;
}

/** The display name of a new account until the user renames it: "ČSOB ••4417". */
export function defaultAccountName(bank: BankInfo, key: string): string {
    const tail = key.startsWith('CARD:') ? key.slice(-4) : key.replace(/\D/g, '').slice(-4);
    return `${bank.name} ${key.startsWith('CARD:') ? 'card ' : ''}••${tail}`;
}

/** What the timeline shows until the user renames the row. */
export function rowName(parsed: ParsedEmail): string {
    return (parsed.counterpartyName ?? parsed.message ?? parsed.counterpartyAccount ?? parsed.kind ?? 'Bank payment').trim();
}

function event(type: string, entityId: string, base: number | undefined, now: number, payload: Record<string, unknown>, id: string) {
    return { id, type, entityId, timestamp: now, ...(base === undefined ? {} : { baseEntityVersion: base }), payload: { id: entityId.split(':').slice(1).join(':'), ...payload } };
}

/**
 * One entity, created or updated. The request and event ids follow from the entity, its version, the mail and when it
 * was handled: a retry inside one handling repeats them exactly, while handling the same mail again later (a released
 * claim, a redelivery) sends new ones, which Ledger would otherwise refuse as the same request with another body.
 */
export async function upsert(
    integration: ServerIntegration,
    entity: string,
    id: string,
    mailKey: string,
    now: number,
    build: (base: number | undefined) => { type: string; payload: Record<string, unknown> },
): Promise<void> {
    const entityId = `${entity}:${id}`;
    await integration.upsertEntity(async (base): Promise<ServiceAppend> => {
        const { type, payload } = build(base);
        const version = String(base ?? 'new');
        const handled = String(now);
        return {
            requestId: await deterministicUuid('finance-bank-request', entityId, version, mailKey, handled),
            events: [event(type, entityId, base, now, payload, await deterministicUuid('finance-bank-event', entityId, version, mailKey, handled))],
        };
    });
}

async function setAside(context: BankMailContext, reading: MailReading & { kind: 'unread' | 'confirmation' }, mailKey: string): Promise<BankMailOutcome> {
    const bank = reading.kind === 'unread' && reading.bank ? bankOfParser(reading.bank) : null;
    const mailId = await deterministicUuid('finance-bank-mail', context.integration.id, mailKey);
    const connectionId = bank ? await connectionIdFor(context.integration.id, bank.id) : '';
    const reason = reading.kind === 'unread' ? reading.reason : 'Forwarding confirmation';
    await upsert(context.integration, 'bank_mail', mailId, mailKey, context.now, (base) => base === undefined
        ? {
            type: 'BANK_MAIL_ADDED',
            payload: {
                integration_id: context.integration.id,
                connection_id: connectionId,
                bank: bank?.id ?? '',
                mail_kind: reading.kind,
                status: 'open',
                from_address: reading.from.slice(0, 300),
                subject: reading.subject.slice(0, 300),
                received_at: new Date(context.now).toISOString(),
                reason,
                code: reading.kind === 'confirmation' ? reading.code : '',
                body_text: reading.text,
            },
        }
        : { type: 'BANK_MAIL_UPDATED', payload: { reason } });
    return { kind: 'set-aside', mailId, reason };
}

export async function handleBankMail(context: BankMailContext): Promise<BankMailOutcome> {
    const { integration, now, store } = context;
    const reading = await readMail(context.raw, { now, ...context.read });
    const mailKey = reading.messageId ?? (await deterministicUuid('finance-bank-raw', String(context.raw.byteLength), reading.subject, reading.sentAt ?? ''));
    if (!(await store.claimMessage(mailKey))) return { kind: 'duplicate' };
    try {
        if (reading.kind !== 'payment') return await setAside(context, reading, mailKey);
        const bank = bankOfParser(reading.bank);
        const parsed = reading.parsed;
        const account = normalizeAccount(parsed.account);
        if (!bank || !account || account.valid === false) {
            return await setAside(context, { ...reading, kind: 'unread', bank: reading.bank, reason: account?.valid === false ? 'The account number in the message did not pass its checksum' : 'The account in the message was not recognised' }, mailKey);
        }
        return await recordPayment(context, bank, parsed, account.key, mailKey, reading.sentAt);
    } catch (error) {
        await store.releaseMessage(mailKey);
        throw error;
    }
}

async function recordPayment(context: BankMailContext, bank: BankInfo, parsed: ParsedEmail, key: string, mailKey: string, sentAt: string | null): Promise<BankMailOutcome> {
    const { integration, now, store } = context;
    const amount = parsed.amount ?? 0;
    const nowIso = new Date(now).toISOString();
    const at = parsed.balanceAt ?? sentAt ?? nowIso;
    const chain = await store.readChain(key);
    const stated = parsed.balanceAfter;
    // A mail about an earlier moment than the last balance (delivered late) adds its row but leaves the balance.
    const late = chain !== null && at < chain.at;
    const balance = late ? null : stated !== null ? stated : round2((chain?.balance ?? 0) + amount);
    const gap = !late && stated !== null && chain !== null ? round2(stated - (chain.balance + amount)) : 0;

    const connectionId = await connectionIdFor(integration.id, bank.id);
    const assetId = await assetIdFor(integration.id, key);
    const bankRef = parsed.reference ? bankRefFor(bank.id, parsed.reference) : `mail:${mailKey}`;
    const transactionId = await transactionIdFor(key, bankRef);

    await upsert(integration, 'bank_connection', connectionId, mailKey, now, (base) => base === undefined
        ? {
            type: 'BANK_CONNECTION_ADDED',
            payload: {
                bank: bank.id,
                provider: 'email',
                country: 'CZ',
                status: 'active',
                last_sync_at: nowIso,
                last_error: '',
                address: context.mailDomain ? `${integration.id}@${context.mailDomain}` : '',
                rows_since: parsed.bookingDate,
            },
        }
        : { type: 'BANK_CONNECTION_UPDATED', payload: { status: 'active', last_sync_at: nowIso, last_error: '' } });

    // A late mail with nothing new for the account (its balance is older, no gap) only adds its row.
    const accountChanged = chain === null || balance !== null || gap !== 0;
    if (accountChanged) await upsert(integration, 'asset', assetId, mailKey, now, (base) => {
        const balanceFields = balance === null ? {} : {
            amount: balance,
            synced_at: nowIso,
            balance_source: stated !== null ? 'bank' : 'derived',
            balance_type: stated !== null ? (parsed.balanceKind ?? '') : 'derived',
        };
        const gapFields = gap !== 0 ? { sync_issue: 'balance_gap', issue_amount: gap } : {};
        if (base !== undefined) return { type: 'ASSET_UPDATED', payload: { ...balanceFields, ...gapFields } };
        return {
            type: 'ASSET_ADDED',
            payload: {
                name: defaultAccountName(bank, key),
                amount: balance ?? amount,
                asset_type: 'asset',
                link: 'bank',
                provider: 'email',
                connection_id: connectionId,
                account_hash: key,
                account_kind: key.startsWith('CARD:') ? 'card' : 'current',
                currency: 'CZK',
                synced_at: nowIso,
                balance_source: stated !== null ? 'bank' : 'derived',
                balance_type: stated !== null ? (parsed.balanceKind ?? '') : 'derived',
                ...gapFields,
            },
        };
    });

    const counterparty = [parsed.counterpartyName, parsed.counterpartyAccount ? normalizeAccount(parsed.counterpartyAccount)?.display ?? parsed.counterpartyAccount : null].filter(Boolean).join(' · ');
    const bankText = [parsed.kind, parsed.message, parsed.variableSymbol && `VS ${parsed.variableSymbol}`].filter(Boolean).join(' · ');
    await upsert(integration, 'transaction', transactionId, mailKey, now, (base) => base === undefined
        ? {
            type: 'TRANSACTION_ADDED',
            payload: {
                name: rowName(parsed),
                amount,
                due_date: parsed.bookingDate,
                transaction_status: 'archived',
                transaction_category: 'unknown',
                category_source: '',
                asset_id: assetId,
                bank_ref: bankRef,
                bank_text: bankText.slice(0, 500),
                counterparty: counterparty.slice(0, 300),
                review: 'new',
            },
        }
        // Already there (a statement brought it first): the user's edits stay; only the bank's own text is refreshed.
        : { type: 'TRANSACTION_UPDATED', payload: { bank_text: bankText.slice(0, 500) } });

    if (balance !== null) await store.writeChain(key, { balance, at });
    return { kind: 'payment', transactionId, assetId, gap };
}

