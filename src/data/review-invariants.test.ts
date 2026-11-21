import { afterEach, describe, expect, it } from 'vitest';
import { DatabaseSync, type SQLInputValue, type StatementSync } from 'node:sqlite';
import { Kysely, SqliteDialect } from 'kysely';
import { getEntityDDLForTables, type Transaction } from '@hearthlog/sdk/data';
import { createReadModelSession, type ReadModelDatabase } from '@hearthlog/sdk/testing';
import { createTimelineRepository } from './finance-timeline.js';
import { createTransactionRepository } from './transactions.js';
import { acceptRows, confirmPlan, confirmTransfer, declinePlan, splitTransfer, transferIdFor, type ReviewEvent } from '../finance/review-commands.js';

/**
 * The forecast must say the same thing however a looks-paid plan is resolved: confirming settles it once, declining
 * counts it again, and Undo returns exactly to before. Decisions are applied to a real read-model database.
 */

const TODAY = '2026-11-21';
const databases: Array<Kysely<ReadModelDatabase>> = [];
afterEach(async () => {
    await Promise.all(databases.splice(0).map((database) => database.destroy()));
});

function wrap(statement: StatementSync, query: string) {
    return {
        reader: /^\s*(?:PRAGMA|SELECT|WITH|EXPLAIN)\b/i.test(query),
        all: (parameters: ReadonlyArray<unknown>) => statement.all(...parameters as SQLInputValue[]),
        run: (parameters: ReadonlyArray<unknown>) => statement.run(...parameters as SQLInputValue[]),
        iterate: (parameters: ReadonlyArray<unknown>) => statement.iterate(...parameters as SQLInputValue[]),
    };
}

function open() {
    const sqlite = new DatabaseSync(':memory:');
    for (const ddl of getEntityDDLForTables(new Set(['assets', 'transactions']))) sqlite.exec(ddl);
    const db = new Kysely<ReadModelDatabase>({
        dialect: new SqliteDialect({ database: { close: () => sqlite.close(), prepare: (query: string) => wrap(sqlite.prepare(query), query) } as never }),
    });
    databases.push(db);
    const session = createReadModelSession(db, { schema: 'main', scope: { tenantId: 't', logId: 'l' }, view: { effectiveNow: `${TODAY}T12:00:00.000Z` } });
    const table = (type: string) => (type.startsWith('ASSET_') ? 'assets' : 'transactions');
    /** Applies events the way projections do: add inserts, update sets the given fields, remove deletes. */
    const apply = (events: ReviewEvent[]) => {
        for (const event of events) {
            const { id, ...fields } = event.payload as Record<string, unknown> & { id: string };
            const name = table(event.type);
            if (event.type.endsWith('_REMOVED')) sqlite.prepare(`DELETE FROM ${name} WHERE id = ?`).run(id);
            else if (event.type.endsWith('_ADDED')) {
                const keys = Object.keys(fields);
                sqlite.prepare(`INSERT INTO ${name} (tenant_id, log_id, id, ${keys.join(', ')}) VALUES ('t', 'l', ?, ${keys.map(() => '?').join(', ')})`)
                    .run(id, ...keys.map((key) => fields[key] as SQLInputValue));
            } else {
                const keys = Object.keys(fields);
                if (keys.length) sqlite.prepare(`UPDATE ${name} SET ${keys.map((key) => `${key} = ?`).join(', ')} WHERE id = ?`).run(...keys.map((key) => fields[key] as SQLInputValue), id);
            }
        }
    };
    apply([
        { id: 'e', type: 'ASSET_ADDED', timestamp: 0, payload: { id: 'current', name: 'ČSOB Běžný účet', amount: 31_500, asset_type: 'asset', link: 'bank' } },
        { id: 'e', type: 'ASSET_ADDED', timestamp: 0, payload: { id: 'cash', name: 'Cash', amount: 3_500, asset_type: 'asset' } },
    ] as never);
    const tx = (payload: Record<string, unknown>) => apply([{ id: 'e', type: 'TRANSACTION_ADDED', timestamp: 0, payload } as never]);
    // The rent already left the account on the 19th; its plan is on the 23rd. A salary comes on the 28th.
    tx({ id: 'rent', name: 'Rent', amount: -18_500, due_date: '2026-11-23', transaction_status: 'active', transaction_category: 'housing', category_source: 'manual' });
    tx({ id: 'bank-rent', name: 'TRVALÝ PŘÍKAZ NÁJEM', amount: -18_500, due_date: '2026-11-19', transaction_status: 'archived', transaction_category: 'unknown', review: 'new', plan_match: 'rent', asset_id: 'current', bank_ref: 'csob:1', bank_text: 'TRVALÝ PŘÍKAZ NÁJEM' });
    tx({ id: 'salary', name: 'Salary', amount: 40_000, due_date: '2026-11-28', transaction_status: 'active', transaction_category: 'income' });
    tx({ id: 'atm', name: 'Výběr z bankomatu', amount: -2_000, due_date: '2026-11-20', transaction_status: 'archived', transaction_category: 'unknown', review: 'new', asset_id: 'current', bank_ref: 'csob:2' });
    const timeline = createTimelineRepository(session);
    const transactions = createTransactionRepository(session);
    const row = async (rowId: string) => (await transactions.getByIds([rowId]))[0] as Transaction;
    const outlook = async () => {
        const value = await timeline.getOutlook({ today: TODAY });
        return { available: value.available, end: value.end, low: value.low.amount };
    };
    return { apply, row, outlook, transactions, timeline };
}

describe('a looks-paid plan', () => {
    it('is settled once by Confirm, and Undo gives back exactly the forecast before', async () => {
        const db = open();
        const before = await db.outlook();
        // Paused: the rent is not counted twice.
        expect(before).toEqual({ available: 35_000, end: 75_000, low: 35_000 });

        const decision = confirmPlan(await db.row('bank-rent'), await db.row('rent'));
        db.apply(decision.events);
        expect(await db.outlook()).toEqual(before);
        expect(await db.row('rent')).toBeUndefined();
        expect(await db.row('bank-rent')).toMatchObject({ name: 'Rent', transaction_category: 'housing', review: 'reviewed', amount: -18_500, due_date: '2026-11-19' });

        db.apply(decision.undo);
        expect(await db.outlook()).toEqual(before);
        const [restored] = (await db.transactions.getOpenPlans('2026-11-01', '2026-11-30')).filter((plan) => plan.name === 'Rent');
        // Back as a plan the row names again: still looks paid, still out of the forecast.
        expect(restored).toBeUndefined();
        expect((await db.row('bank-rent')).plan_match).not.toBe('none');
        expect(await db.row('bank-rent')).toMatchObject({ name: 'TRVALÝ PŘÍKAZ NÁJEM', review: 'new', transaction_category: 'unknown' });
    });

    it('counts again after Not this one, and Undo pauses it again', async () => {
        const db = open();
        const before = await db.outlook();
        const decision = declinePlan(await db.row('bank-rent'));
        db.apply(decision.events);
        expect(await db.outlook()).toEqual({ available: 35_000, end: 56_500, low: 16_500 });
        db.apply(decision.undo);
        expect(await db.outlook()).toEqual(before);
    });
});

describe('a withdrawal into Cash', () => {
    it('raises the hand-kept Cash balance once and stays out of spending; Undo restores both', async () => {
        const db = open();
        const before = await db.outlook();
        const atm = await db.row('atm');
        const decision = confirmTransfer([atm], await transferIdFor(atm.id), { id: 'cash', amount: 3_500, add: 2_000 });
        db.apply(decision.events);
        // The bank balance already went down by 2 000; Cash goes up by the same, so the sum is whole again.
        expect((await db.outlook()).available).toBe(before.available + 2_000);
        const [month] = await db.timeline.getMonths({ today: TODAY, from: '2026-11-01', to: '2026-11-30', show: 'done' });
        expect(month).toMatchObject({ expense: -18_500 });
        db.apply(decision.undo);
        expect(await db.outlook()).toEqual(before);
        expect((await db.row('atm')).transaction_category).toBe('unknown');
    });

    it('stays an ordinary row when split, and is not offered again', async () => {
        const db = open();
        const decision = splitTransfer([await db.row('atm')]);
        db.apply(decision.events);
        expect((await db.transactions.getTransferCandidates('2026-11-01')).map((row) => row.id)).not.toContain('atm');
        db.apply(decision.undo);
        expect((await db.transactions.getTransferCandidates('2026-11-01')).map((row) => row.id)).toContain('atm');
    });
});

describe('accepting rows', () => {
    it('reviews them with their category and leaves every balance alone', async () => {
        const db = open();
        const before = await db.outlook();
        const decision = acceptRows([{ row: await db.row('atm'), category: 'other', source: 'history' }]);
        db.apply(decision.events);
        expect(await db.outlook()).toEqual(before);
        expect(await db.transactions.countReview()).toEqual({ pending: 1, unmatched: 0 });
        db.apply(decision.undo);
        expect(await db.transactions.countReview()).toEqual({ pending: 2, unmatched: 1 });
    });
});
