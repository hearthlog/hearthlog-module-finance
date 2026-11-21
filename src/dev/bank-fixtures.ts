/**
 * A development-only bank provider: it writes the accounts, rows and plans of the Main, Account and States boards
 * through ordinary local commands, so the linked-accounts screens can be built and checked before any real provider
 * exists. Only `import.meta.env.DEV` builds offer it (see DevBankPanel); a deployed site never bundles a call to it.
 * Every id is fixed, so loading twice changes nothing and removing takes exactly what was loaded.
 */

import { addDays, addHours, addMinutes, format, subDays, subHours, subMinutes } from 'date-fns';
import {
    executeLocalCommand,
    queryDatabase,
    type AddAssetEvent,
    type AddBankConnectionEvent,
    type AddTransactionEvent,
    type UpdateAssetEvent,
    type UpdateBankConnectionEvent,
} from '@hearthlog/sdk/data';
import { linkAsset, unlinkAsset } from '../finance/account-commands.js';

const id = (n: number) => `d0b1f1c5-0000-4000-8000-${String(n).padStart(12, '0')}`;

const CONNECTIONS = { csob: id(1), airbank: id(2), revolut: id(3) } as const;
/** Fixture rows are numbered 101–112 (bank rows) and 201–206 (plans). */
const ROW_IDS = [...Array.from({ length: 12 }, (_, i) => id(101 + i)), ...Array.from({ length: 6 }, (_, i) => id(201 + i))];
const ACCOUNTS = { current: id(11), savings: id(12), air: id(13), card: id(14), eur: id(15), cash: id(16) } as const;

export type FixtureState = 'current' | 'quiet' | 'unread' | 'gap' | 'limit' | 'renew' | 'expired' | 'email-states';

export const FIXTURE_STATES: Array<{ value: FixtureState; label: string }> = [
    { value: 'current', label: 'Every account current' },
    { value: 'email-states', label: 'Every email state at once' },
    { value: 'quiet', label: 'Air Bank quiet too long' },
    { value: 'unread', label: 'Card email not understood' },
    { value: 'gap', label: 'Běžný účet balances do not add up' },
    { value: 'limit', label: 'Revolut bank limit reached' },
    { value: 'renew', label: 'Revolut approval ends soon' },
    { value: 'expired', label: 'Revolut approval expired' },
];

const iso = (date: Date) => date.toISOString();
const dayOf = (date: Date) => format(date, 'yyyy-MM-dd');

async function run(events: Array<{ type: string }>): Promise<void> {
    for (const event of events) await executeLocalCommand(event as never);
}

function event<T extends { type: string; payload: unknown }>(type: T['type'], payload: T['payload']): T {
    return { id: crypto.randomUUID(), type, timestamp: Date.now(), payload } as T;
}

async function existingIds(): Promise<{ assets: Set<string>; connections: Set<string>; transactions: Set<string>; manual: Array<{ id: string; name: string }> }> {
    return queryDatabase(async (repositories) => {
        const [assets, connections, transactions] = await Promise.all([
            repositories.assets.getAssets(),
            repositories.assets.getBankConnections(),
            repositories.transactions.existingIds(ROW_IDS),
        ]);
        return {
            assets: new Set(assets.map((asset) => asset.id)),
            connections: new Set(connections.map((connection) => connection.id)),
            transactions: new Set(transactions),
            manual: assets.filter((asset) => asset.link !== 'bank' && !Object.values(ACCOUNTS).includes(asset.id as never))
                .map((asset) => ({ id: asset.id, name: asset.name })),
        };
    });
}

/** The hand-kept assets that are not fixtures, for "convert into a linked account". */
export async function manualAssets(): Promise<Array<{ id: string; name: string }>> {
    return (await existingIds()).manual;
}

export async function loadFixtures(now = new Date()): Promise<void> {
    const have = await existingIds();
    const today = dayOf(now);
    const day = (offset: number) => dayOf(addDays(now, offset));
    const events: Array<{ type: string }> = [];

    const connections: Array<AddBankConnectionEvent['payload']> = [
        { id: CONNECTIONS.csob, bank: 'csob', provider: 'email', status: 'active', address: 'fin-dev7k2q@in.example.test', rows_since: `${today.slice(0, 7)}-01`, last_sync_at: iso(subMinutes(now, 12)) },
        { id: CONNECTIONS.airbank, bank: 'airbank', provider: 'email', status: 'active', address: 'fin-dev7k2q+air@in.example.test', rows_since: `${today.slice(0, 7)}-01`, last_sync_at: iso(subHours(now, 2)) },
        { id: CONNECTIONS.revolut, bank: 'revolut', provider: 'enable_banking', status: 'active', valid_until: iso(addDays(now, 80)), last_sync_at: iso(subHours(now, 2)) },
    ];
    for (const payload of connections) if (!have.connections.has(payload.id)) events.push(event<AddBankConnectionEvent>('BANK_CONNECTION_ADDED', payload));

    const linked = (payload: Omit<AddAssetEvent['payload'], 'asset_type'>): AddAssetEvent['payload'] => ({ asset_type: 'asset', link: 'bank', currency: 'CZK', balance_source: 'bank', ...payload });
    const assets: Array<AddAssetEvent['payload']> = [
        linked({ id: ACCOUNTS.current, name: 'ČSOB Běžný účet', amount: 84_310, provider: 'email', connection_id: CONNECTIONS.csob, account_kind: 'current', account_hash: 'CZ0003000000000000004417', balance_type: 'CLBD', synced_at: iso(subMinutes(now, 12)) }),
        linked({ id: ACCOUNTS.savings, name: 'ČSOB Spořicí', amount: 210_000, provider: 'email', connection_id: CONNECTIONS.csob, account_kind: 'savings', account_hash: 'CZ0003000000000000008802', balance_type: 'CLBD', synced_at: iso(subDays(now, 3)) }),
        linked({ id: ACCOUNTS.air, name: 'Air Bank', amount: 12_480, provider: 'email', connection_id: CONNECTIONS.airbank, account_kind: 'current', account_hash: 'CZ0030300000000000001290', balance_type: 'ITAV', synced_at: iso(subHours(now, 2)) }),
        linked({ id: ACCOUNTS.card, name: 'ČSOB kreditní karta', amount: -6_240, provider: 'email', connection_id: CONNECTIONS.csob, account_kind: 'card', account_hash: 'CARD:400000…0042', balance_type: 'CLBD', synced_at: iso(subDays(now, 1)) }),
        linked({ id: ACCOUNTS.eur, name: 'Revolut EUR', amount: 10_020, provider: 'enable_banking', connection_id: CONNECTIONS.revolut, account_kind: 'current', account_hash: 'LT000000000000000077', currency: 'EUR', native_amount: 412.5, balance_type: 'ITAV', synced_at: iso(subHours(now, 2)) }),
        { id: ACCOUNTS.cash, name: 'Cash', amount: 3_500, asset_type: 'asset', link: 'manual' },
    ];
    for (const payload of assets) if (!have.assets.has(payload.id)) events.push(event<AddAssetEvent>('ASSET_ADDED', payload));

    type Row = { n: number; name: string; amount: number; date: string; asset?: string; category: string; review?: string; bank_text?: string; plan_match?: string; transfer_id?: string; planned?: boolean };
    const rows: Row[] = [
        { n: 101, name: 'Dr. Max lékárna', amount: -436, date: day(-5), asset: ACCOUNTS.card, category: 'health' },
        { n: 102, name: 'Rohlik.cz', amount: -2_140, date: day(-4), asset: ACCOUNTS.current, category: 'food', review: 'reviewed' },
        { n: 103, name: 'Spotify', amount: -169, date: day(-4), asset: ACCOUNTS.air, category: 'subscriptions' },
        { n: 104, name: 'To savings', amount: -10_000, date: day(-3), asset: ACCOUNTS.current, category: 'transfer', transfer_id: id(900) },
        { n: 105, name: 'To savings', amount: 10_000, date: day(-3), asset: ACCOUNTS.savings, category: 'transfer', transfer_id: id(900) },
        { n: 106, name: 'Lidl', amount: -742, date: day(-3), asset: ACCOUNTS.card, category: 'food' },
        { n: 107, name: 'TRVALÝ PŘÍKAZ NÁJEM', amount: -18_500, date: day(-2), asset: ACCOUNTS.current, category: 'housing', plan_match: id(201) },
        { n: 108, name: 'Alza.cz', amount: -3_290, date: day(-2), asset: ACCOUNTS.current, category: 'unknown' },
        { n: 109, name: 'Albert', amount: -1_284, date: day(-1), asset: ACCOUNTS.card, category: 'food' },
        { n: 110, name: 'Shell', amount: -1_650, date: day(-1), asset: ACCOUNTS.card, category: 'transport' },
        { n: 111, name: 'ATM withdrawal', amount: -2_000, date: day(-1), asset: ACCOUNTS.current, category: 'transfer' },
        { n: 112, name: 'Bolt', amount: -189, date: today, asset: ACCOUNTS.current, category: 'transport', review: 'reviewed' },
        { n: 201, name: 'Rent', amount: -18_500, date: day(1), category: 'housing', planned: true },
        { n: 202, name: 'Electricity', amount: -2_350, date: day(3), category: 'housing', planned: true },
        { n: 203, name: 'Internet', amount: -599, date: day(5), category: 'subscriptions', planned: true },
        { n: 204, name: 'Salary', amount: 72_000, date: day(10), asset: ACCOUNTS.current, category: 'income', planned: true },
        { n: 205, name: 'Car insurance', amount: -8_400, date: day(13), category: 'transport', planned: true },
        { n: 206, name: 'Kindergarten', amount: -4_200, date: day(15), category: 'kids', planned: true },
    ];
    for (const row of rows) {
        if (have.transactions.has(id(row.n))) continue;
        events.push(event<AddTransactionEvent>('TRANSACTION_ADDED', {
            id: id(row.n),
            name: row.name,
            amount: row.amount,
            due_date: row.date,
            transaction_status: row.planned ? 'active' : 'archived',
            transaction_category: row.category,
            category_source: row.planned || row.review === 'reviewed' ? 'manual' : 'history',
            ...(row.asset ? { asset_id: row.asset } : {}),
            ...(row.planned ? {} : { bank_ref: `dev:${row.n}`, bank_text: row.bank_text ?? row.name.toUpperCase(), review: row.review ?? 'new' }),
            ...(row.plan_match ? { plan_match: row.plan_match } : {}),
            ...(row.transfer_id ? { transfer_id: row.transfer_id } : {}),
        }));
    }
    await run(events);
}

/** Puts the fixture accounts into one state of the States board (after resetting them to current). */
export async function applyState(state: FixtureState, now = new Date()): Promise<void> {
    const asset = (payload: UpdateAssetEvent['payload']) => event<UpdateAssetEvent>('ASSET_UPDATED', payload);
    const connection = (payload: UpdateBankConnectionEvent['payload']) => event<UpdateBankConnectionEvent>('BANK_CONNECTION_UPDATED', payload);
    const events: Array<{ type: string }> = [
        asset({ id: ACCOUNTS.current, amount: 84_310, sync_issue: '', issue_amount: 0, synced_at: iso(subMinutes(now, 12)) }),
        asset({ id: ACCOUNTS.air, synced_at: iso(subHours(now, 2)) }),
        asset({ id: ACCOUNTS.card, sync_issue: '', issue_count: 0 }),
        asset({ id: ACCOUNTS.eur, synced_at: iso(subHours(now, 2)) }),
        connection({ id: CONNECTIONS.revolut, status: 'active', valid_until: iso(addDays(now, 80)), next_try_at: '' }),
    ];
    const quiet = asset({ id: ACCOUNTS.air, synced_at: iso(subDays(now, 9)) });
    const unread = asset({ id: ACCOUNTS.card, sync_issue: 'unread_mail', issue_count: 1 });
    const gap = asset({ id: ACCOUNTS.current, amount: 83_070, sync_issue: 'balance_gap', issue_amount: -1_240 });
    switch (state) {
        case 'quiet': events.push(quiet); break;
        case 'unread': events.push(unread); break;
        case 'gap': events.push(gap); break;
        case 'email-states': events.push(quiet, unread, gap); break;
        case 'limit':
            events.push(
                asset({ id: ACCOUNTS.eur, synced_at: iso(subHours(now, 7)) }),
                connection({ id: CONNECTIONS.revolut, status: 'rate_limited', next_try_at: iso(addMinutes(addHours(now, 6), 0)) }),
            );
            break;
        case 'renew': events.push(connection({ id: CONNECTIONS.revolut, valid_until: iso(addDays(now, 14)) })); break;
        case 'expired':
            events.push(
                asset({ id: ACCOUNTS.eur, synced_at: iso(subDays(now, 6)) }),
                connection({ id: CONNECTIONS.revolut, status: 'expired', valid_until: iso(subDays(now, 6)) }),
            );
            break;
        case 'current': break;
    }
    await run(events);
}

/** Converts a hand-kept asset into a linked Air Bank account, the way linking offers to instead of duplicating it. */
export async function convertToLinked(assetId: string, now = new Date()): Promise<void> {
    const have = await existingIds();
    if (!have.connections.has(CONNECTIONS.airbank)) {
        await run([event<AddBankConnectionEvent>('BANK_CONNECTION_ADDED', { id: CONNECTIONS.airbank, bank: 'airbank', provider: 'email', status: 'active', address: 'fin-dev7k2q+air@in.example.test', rows_since: dayOf(now) })]);
    }
    const current = await queryDatabase((repositories) => repositories.assets.getAssets());
    const asset = current.find((entry) => entry.id === assetId);
    if (!asset) return;
    await linkAsset(asset, {
        provider: 'email',
        connection_id: CONNECTIONS.airbank,
        account_hash: `CZ00303000000000${String(Math.abs(hash(assetId))).padStart(8, '0').slice(0, 8)}`,
        account_kind: 'current',
        currency: 'CZK',
        balance_type: 'ITAV',
        balance_source: 'bank',
        synced_at: iso(now),
    }, Number(asset.amount));
}

function hash(text: string): number {
    let value = 0;
    for (const char of text) value = (value * 31 + char.charCodeAt(0)) | 0;
    return value;
}

/** Removes everything the fixtures added; an asset converted onto a fixture connection goes back to being kept by hand. */
export async function removeFixtures(): Promise<void> {
    const have = await existingIds();
    const assets = await queryDatabase((repositories) => repositories.assets.getAssets());
    const fixtureConnections = new Set<string>(Object.values(CONNECTIONS));
    for (const asset of assets) {
        if (asset.link === 'bank' && fixtureConnections.has(asset.connection_id) && !Object.values(ACCOUNTS).includes(asset.id as never)) await unlinkAsset(asset);
    }
    const events: Array<{ type: string }> = [];
    for (const transaction of have.transactions) if (transaction.startsWith('d0b1f1c5-')) events.push(event('TRANSACTION_REMOVED' as never, { id: transaction } as never));
    for (const asset of have.assets) if (asset.startsWith('d0b1f1c5-')) events.push(event('ASSET_REMOVED' as never, { id: asset } as never));
    for (const connection of have.connections) if (connection.startsWith('d0b1f1c5-')) events.push(event('BANK_CONNECTION_REMOVED' as never, { id: connection } as never));
    await run(events);
}
