import { beforeAll, describe, expect, it } from 'vitest';
import type { ServerIntegration, ServiceAppend } from '@hearthlog/sdk/server';
import { memoryEbState } from '../bank-state.js';
import { assetIdFor, connectionIdFor, transactionIdFor } from '../../finance/bank-ids.js';
import { finishApproval, startApproval } from './approval.js';
import type { EbConfig } from './client.js';
import { parseCnbRates } from './rates.js';
import { backgroundDue, presentAllowed, syncSession } from './sync.js';

/**
 * Revolut through a fake Enable Banking: it answers like the real API (made-up accounts and rows) and records each
 * call, so linking, the Kč conversion, a renewed approval, the bank's rate limit and the end of an approval can be
 * checked without the network.
 */

const NOW = Date.UTC(2026, 10, 21, 10, 0);
const IBAN = 'LT121000011101001000';
let privateKey = '';

beforeAll(async () => {
    const pair = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']);
    const der = new Uint8Array(await crypto.subtle.exportKey('pkcs8', pair.privateKey));
    privateKey = `-----BEGIN PRIVATE KEY-----\n${btoa(String.fromCharCode(...der))}\n-----END PRIVATE KEY-----`;
});

interface FakeOptions { uid?: string; rateLimited?: boolean; expired?: boolean }

function fakeEnableBanking(options: FakeOptions = {}) {
    const calls: Array<{ method: string; path: string; query: Record<string, string>; psu: boolean }> = [];
    const state = { ...options };
    const fetcher = (async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = new URL(String(input));
        const headers = new Headers(init?.headers);
        if (!headers.get('authorization')?.startsWith('Bearer ey')) return Response.json({ error: 'UNAUTHORIZED' }, { status: 401 });
        calls.push({ method: init?.method ?? 'GET', path: url.pathname, query: Object.fromEntries(url.searchParams), psu: headers.has('Psu-Ip-Address') });
        if (state.expired && url.pathname.startsWith('/accounts/')) return Response.json({ error: 'EXPIRED_SESSION', message: 'Session expired' }, { status: 401 });
        if (state.rateLimited && url.pathname.startsWith('/accounts/')) return Response.json({ error: 'ASPSP_RATE_LIMIT_EXCEEDED', message: 'Limit' }, { status: 429 });
        if (url.pathname === '/aspsps') return Response.json({ aspsps: [{ name: 'Revolut', country: 'CZ', maximum_consent_validity: 90 * 86_400 }] });
        if (url.pathname === '/auth') return Response.json({ url: 'https://bank.example/approve?id=1' });
        if (url.pathname === '/sessions') {
            return Response.json({
                session_id: `session-${state.uid ?? 'a'}`,
                access: { valid_until: '2027-02-19T10:00:00Z' },
                accounts: [{ uid: state.uid ?? 'uid-a', identification_hash: 'hash-eur', account_id: { iban: IBAN }, currency: 'EUR' }],
            });
        }
        if (url.pathname.endsWith('/balances')) {
            return Response.json({ balances: [{ balance_type: 'CLBD', balance_amount: { amount: '400.00', currency: 'EUR' } }, { balance_type: 'ITAV', balance_amount: { amount: '412.50', currency: 'EUR' } }] });
        }
        if (url.pathname.endsWith('/transactions')) {
            if (!url.searchParams.get('continuation_key')) {
                return Response.json({
                    continuation_key: 'page-2',
                    transactions: [
                        { entry_reference: 'r1', status: 'BOOK', booking_date: '2026-11-18', credit_debit_indicator: 'DBIT', transaction_amount: { amount: '12.00', currency: 'EUR' }, creditor: { name: 'Café' } },
                        { entry_reference: 'p1', status: 'PDNG', booking_date: '2026-11-20', credit_debit_indicator: 'DBIT', transaction_amount: { amount: '5.00', currency: 'EUR' } },
                    ],
                });
            }
            return Response.json({ transactions: [{ entry_reference: 'r2', status: 'BOOK', booking_date: '2026-11-19', credit_debit_indicator: 'CRDT', transaction_amount: { amount: '100.00', currency: 'EUR' }, debtor: { name: 'Top-up' } }] });
        }
        return Response.json({ error: 'NOT_FOUND' }, { status: 404 });
    }) as typeof fetch;
    return { calls, state, fetcher };
}

function fakeLedger() {
    const versions = new Map<string, number>();
    const events = new Map<string, Array<{ type: string; payload: Record<string, unknown> }>>();
    const integration: ServerIntegration = {
        id: 'revolut',
        kind: 'bank-approval',
        logId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
        async upsertEntity(build) {
            let append: ServiceAppend = await build(undefined);
            const entityId = append.events[0]!.entityId;
            const live = versions.get(entityId);
            if (live !== undefined) append = await build(live);
            versions.set(entityId, (live ?? 0) + 1);
            events.set(entityId, [...(events.get(entityId) ?? []), ...append.events.map((e) => ({ type: e.type, payload: e.payload }))]);
            return live === undefined ? 'created' : 'updated';
        },
    };
    const state = (entityId: string) => Object.assign({}, ...(events.get(entityId) ?? []).map((e) => e.payload)) as Record<string, unknown>;
    return { integration, events, state };
}

const rates = async (currency: string) => ({ CZK: 1, EUR: 25 } as Record<string, number>)[currency] ?? null;
const psu = { 'Psu-Ip-Address': '203.0.113.7', 'Psu-User-Agent': 'test' };

async function link(bank: ReturnType<typeof fakeEnableBanking>, ledger = fakeLedger(), store = memoryEbState(), now = NOW) {
    const config: EbConfig = { appId: 'app', privateKey, fetch: bank.fetcher };
    const started = await startApproval({ config, store, bank: 'revolut', redirectUrl: 'https://site.example/api/finance/bank/v1/eb/callback', now });
    const state = [...store.pending.keys()].at(-1)!;
    const finished = await finishApproval({ config, store, integration: ledger.integration, code: 'code', state, now, psu, rates });
    return { config, store, ledger, started, finished };
}

describe('linking Revolut', () => {
    it('sends the user to the bank for as long as it allows, then syncs balances and booked rows in Kč', async () => {
        const bank = fakeEnableBanking();
        const { started, finished, ledger, store } = await link(bank);
        expect(started.url).toBe('https://bank.example/approve?id=1');
        expect(finished?.outcome).toEqual({ status: 'synced', rows: 2 });

        const assetId = await assetIdFor('revolut', IBAN);
        expect(ledger.state(`asset:${assetId}`)).toMatchObject({
            name: 'Revolut EUR', amount: 10_312.5, native_amount: 412.5, currency: 'EUR', balance_type: 'ITAV', provider: 'enable_banking', account_hash: IBAN,
        });
        const coffee = await transactionIdFor(IBAN, 'eb:r1');
        expect(ledger.state(`transaction:${coffee}`)).toMatchObject({ name: 'Café', amount: -300, native_amount: -12, native_currency: 'EUR', due_date: '2026-11-18', review: 'new', asset_id: assetId });
        // Pending entries stay out until booked.
        expect([...ledger.events.keys()].filter((key) => key.startsWith('transaction:'))).toHaveLength(2);
        const connection = ledger.state(`bank_connection:${await connectionIdFor('revolut', 'revolut')}`);
        expect(connection).toMatchObject({ bank: 'revolut', provider: 'enable_banking', status: 'active', valid_until: '2027-02-19T10:00:00Z' });
        // The first fetch asks for everything; it is the user's own, so it carries their presence.
        expect(bank.calls.find((call) => call.path.endsWith('/transactions'))).toMatchObject({ query: { strategy: 'longest', transaction_status: 'BOOK' }, psu: true });
        expect((await store.listSessions())[0]).toMatchObject({ lastBooked: { [IBAN]: '2026-11-19' }, status: 'active' });
    });

    it('keeps the account and its rows through a renewed approval, and goes on from the last booked day', async () => {
        const first = fakeEnableBanking({ uid: 'uid-a' });
        const { ledger, store } = await link(first);
        const renewed = fakeEnableBanking({ uid: 'uid-b' });
        const again = await link(renewed, ledger, store, NOW + 86_400_000);
        expect(again.finished?.outcome.status).toBe('synced');
        expect([...ledger.events.keys()].filter((key) => key.startsWith('asset:'))).toHaveLength(1);
        expect([...ledger.events.keys()].filter((key) => key.startsWith('transaction:'))).toHaveLength(2);
        expect(renewed.calls.find((call) => call.path.endsWith('/transactions'))).toMatchObject({ path: '/accounts/uid-b/transactions', query: { date_from: '2026-11-12' } });
    });

    it('refuses an unknown or stale approval state', async () => {
        const bank = fakeEnableBanking();
        const store = memoryEbState();
        const config: EbConfig = { appId: 'app', privateKey, fetch: bank.fetcher };
        expect(await finishApproval({ config, store, integration: fakeLedger().integration, code: 'c', state: 'made-up', now: NOW, psu, rates })).toBeNull();
        await startApproval({ config, store, bank: 'revolut', redirectUrl: 'https://x', now: NOW });
        const state = [...store.pending.keys()][0]!;
        expect(await finishApproval({ config, store, integration: fakeLedger().integration, code: 'c', state, now: NOW + 2 * 3_600_000, psu, rates })).toBeNull();
    });
});

describe('background sync', () => {
    it('runs every six hours, waits out the bank’s rate limit, and lets the user refresh every five minutes', async () => {
        const bank = fakeEnableBanking();
        const { config, store, ledger } = await link(bank);
        const session = (await store.listSessions())[0]!;
        expect(backgroundDue(session, NOW)).toBe(true); // linked with the user present, no background fetch yet
        await syncSession({ integration: ledger.integration, session, config, store, rates, now: NOW });
        const after = (await store.listSessions())[0]!;
        expect(backgroundDue(after, NOW + 5 * 3_600_000)).toBe(false);
        expect(backgroundDue(after, NOW + 6 * 3_600_000)).toBe(true);
        expect(presentAllowed(after, NOW + 60_000)).toBe(false); // linking itself was a present fetch a minute ago
        expect(presentAllowed(after, NOW + 5 * 60_000)).toBe(true);

        bank.state.rateLimited = true;
        const later = NOW + 6 * 3_600_000;
        const limited = await syncSession({ integration: ledger.integration, session: after, config, store, rates, now: later });
        expect(limited).toMatchObject({ status: 'rate_limited' });
        expect(ledger.state(`bank_connection:${await connectionIdFor('revolut', 'revolut')}`)).toMatchObject({ status: 'rate_limited' });
        expect(backgroundDue((await store.listSessions())[0]!, later + 3_600_000)).toBe(false);
    });

    it('stops cleanly when the approval ends, by date or by the bank, and keeps the last balance', async () => {
        const bank = fakeEnableBanking();
        const { config, store, ledger } = await link(bank);
        const assetId = await assetIdFor('revolut', IBAN);
        const balance = ledger.state(`asset:${assetId}`).amount;

        bank.state.expired = true;
        const session = (await store.listSessions())[0]!;
        expect(await syncSession({ integration: ledger.integration, session, config, store, rates, now: NOW + 3_600_000 })).toEqual({ status: 'expired' });
        expect(ledger.state(`bank_connection:${await connectionIdFor('revolut', 'revolut')}`)).toMatchObject({ status: 'expired' });
        const stopped = (await store.listSessions())[0]!;
        expect(backgroundDue(stopped, NOW + 30 * 3_600_000)).toBe(false);
        expect(presentAllowed(stopped, NOW + 30 * 3_600_000)).toBe(false);
        expect(ledger.state(`asset:${assetId}`).amount).toBe(balance);

        // By date: no call to the bank at all.
        const calls = bank.calls.length;
        const dated = { ...session, status: 'active' as const, validUntil: new Date(NOW).toISOString() };
        expect(await syncSession({ integration: ledger.integration, session: dated, config, store, rates, now: NOW + 1 })).toEqual({ status: 'expired' });
        expect(bank.calls.length).toBe(calls);
    });
});

describe('ČNB rates', () => {
    it('reads the daily file, per unit', () => {
        const rates = parseCnbRates('20.11.2026 #224\nzemě|měna|množství|kód|kurz\nEMU|euro|1|EUR|25,155\nJaponsko|jen|100|JPY|15,512\n');
        expect(rates.get('EUR')).toBe(25.155);
        expect(rates.get('JPY')).toBeCloseTo(0.15512);
        expect(rates.get('CZK')).toBe(1);
    });
});
