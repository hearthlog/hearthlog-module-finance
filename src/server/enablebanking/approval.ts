/**
 * Read access at a bank through Enable Banking: start sends the user to the bank with a random state; the bank sends
 * them back to the callback with a code, which becomes a session listing the shared accounts. A renewal is the same
 * trip: the accounts keep their assets (they are keyed by account number, not by the session's ids) and the sync goes
 * on from the last booked day.
 */

import type { ServerIntegration } from '@hearthlog/sdk/server';
import { normalizeAccount } from '../../finance/account-keys.js';
import { connectionIdFor } from '../../finance/bank-ids.js';
import type { EbAccount, EbStateStore } from '../bank-state.js';
import { ebCall, type EbConfig, type PsuHeaders } from './client.js';
import type { RateLookup } from './rates.js';
import { syncSession, type SyncOutcome } from './sync.js';

/** The banks linked this way: Enable Banking's name for each, in Czechia. */
export const APPROVAL_BANKS: Record<string, { aspsp: string; country: string; label: string }> = {
    revolut: { aspsp: 'Revolut', country: 'CZ', label: 'Revolut' },
};

const MAX_DAYS = 180;

export async function startApproval(input: {
    config: EbConfig;
    store: EbStateStore;
    bank: string;
    redirectUrl: string;
    now: number;
}): Promise<{ url: string }> {
    const bank = APPROVAL_BANKS[input.bank];
    if (!bank) throw new Error(`Unknown bank ${input.bank}`);
    // As long as the bank allows, at most 180 days.
    const { aspsps = [] } = await ebCall<{ aspsps?: Array<{ name: string; maximum_consent_validity?: number }> }>(input.config, 'GET', '/aspsps', {
        query: { country: bank.country, psu_type: 'personal', service: 'AIS' },
        now: input.now,
    });
    const listed = aspsps.find((entry) => entry.name.toLowerCase() === bank.aspsp.toLowerCase());
    const seconds = Math.min(listed?.maximum_consent_validity ?? MAX_DAYS * 86_400, MAX_DAYS * 86_400);
    const state = crypto.randomUUID();
    const { url } = await ebCall<{ url: string }>(input.config, 'POST', '/auth', {
        body: {
            access: { valid_until: new Date(input.now + seconds * 1000).toISOString() },
            aspsp: { name: listed?.name ?? bank.aspsp, country: bank.country },
            state,
            redirect_url: input.redirectUrl,
            psu_type: 'personal',
        },
        now: input.now,
    });
    await input.store.putPending(state, { bank: input.bank, createdAt: new Date(input.now).toISOString() });
    return { url };
}

interface EbSessionAccount {
    uid: string;
    identification_hash?: string;
    account_id?: { iban?: string | null; other?: { identification?: string } | null } | null;
    currency?: string;
    name?: string | null;
    product?: string | null;
}

/** The shared accounts, keyed by IBAN when the bank gives one, else by Enable Banking's identification hash. */
export function accountsOf(raw: readonly EbSessionAccount[], bankLabel: string): EbAccount[] {
    return raw.map((account) => {
        const iban = normalizeAccount(account.account_id?.iban ?? null);
        const currency = (account.currency ?? 'CZK').toUpperCase();
        return {
            uid: account.uid,
            key: iban && iban.kind !== 'unknown' ? iban.key : `EB:${account.identification_hash ?? account.uid}`,
            currency,
            name: `${bankLabel} ${currency}`,
        };
    });
}

export async function finishApproval(input: {
    config: EbConfig;
    store: EbStateStore;
    integration: ServerIntegration;
    code: string;
    state: string;
    now: number;
    psu: PsuHeaders;
    rates: RateLookup;
}): Promise<{ bank: string; outcome: SyncOutcome } | null> {
    const pending = await input.store.takePending(input.state, input.now);
    if (!pending) return null;
    const bank = APPROVAL_BANKS[pending.bank];
    if (!bank) return null;
    const created = await ebCall<{ session_id: string; accounts?: EbSessionAccount[]; access?: { valid_until?: string } }>(input.config, 'POST', '/sessions', { body: { code: input.code }, now: input.now });
    const connectionId = await connectionIdFor(input.integration.id, pending.bank);
    const previous = await input.store.getSession(connectionId);
    const session = {
        connectionId,
        bank: pending.bank,
        sessionId: created.session_id,
        validUntil: created.access?.valid_until ?? new Date(input.now + 90 * 86_400_000).toISOString(),
        accounts: accountsOf(created.accounts ?? [], bank.label),
        lastBackgroundAt: null,
        lastPresentAt: null,
        nextTryAt: null,
        // A renewal goes on from where the last approval stopped.
        lastBooked: previous?.lastBooked ?? {},
        status: 'active' as const,
    };
    await input.store.putSession(session);
    const outcome = await syncSession({ integration: input.integration, session, config: input.config, store: input.store, rates: input.rates, now: input.now, psu: input.psu });
    return { bank: pending.bank, outcome };
}
