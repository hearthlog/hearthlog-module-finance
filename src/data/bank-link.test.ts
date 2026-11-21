import { afterEach, describe, expect, it } from 'vitest';
import { DatabaseSync, type SQLInputValue, type StatementSync } from 'node:sqlite';
import { Kysely, SqliteDialect } from 'kysely';
import { getEntityDDLForTables } from '@hearthlog/sdk/data';
import { createReadModelSession, type ReadModelDatabase } from '@hearthlog/sdk/testing';
import { createTimelineRepository } from './finance-timeline.js';
import { createForecastRepository } from './forecast.js';
import { createPlannedDaysRepository } from './planned-days.js';
import { createTransactionRepository } from './transactions.js';

/**
 * The counting rules linked bank accounts bring: a plan a bank row looks like it paid leaves the forecast, a move
 * between the user's own accounts is neither income nor spending and moves no balance, and a credit card is an asset
 * with a negative amount inside the one sum.
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

interface Row {
    id: string;
    amount: number;
    date: string;
    status?: 'active' | 'archived';
    category?: string;
    plan_match?: string;
    transfer_id?: string;
    asset_id?: string;
    bank_ref?: string;
}

interface Asset { id: string; amount: number; link?: string; account_kind?: string }

function open(assets: Asset[], rows: Row[]) {
    const sqlite = new DatabaseSync(':memory:');
    for (const ddl of getEntityDDLForTables(new Set(['assets', 'transactions']))) sqlite.exec(ddl);
    const asset = sqlite.prepare('INSERT INTO assets (tenant_id, log_id, id, name, amount, asset_type, link, account_kind) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
    for (const entry of assets) asset.run('tenant-a', 'log-a', entry.id, entry.id, entry.amount, 'asset', entry.link ?? 'manual', entry.account_kind ?? '');
    const insert = sqlite.prepare(`INSERT INTO transactions
        (tenant_id, log_id, id, name, amount, due_date, transaction_status, transaction_category, plan_match, transfer_id, asset_id, bank_ref, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    rows.forEach((row, index) => insert.run(
        'tenant-a', 'log-a', row.id, row.id, row.amount, row.date, row.status ?? 'active', row.category ?? 'other',
        row.plan_match ?? '', row.transfer_id ?? '', row.asset_id ?? '', row.bank_ref ?? '', `2026-11-01 00:00:${String(index).padStart(2, '0')}`,
    ));
    const db = new Kysely<ReadModelDatabase>({
        dialect: new SqliteDialect({ database: { close: () => sqlite.close(), prepare: (query: string) => wrap(sqlite.prepare(query), query) } as never }),
    });
    databases.push(db);
    const session = createReadModelSession(db, {
        schema: 'main',
        scope: { tenantId: 'tenant-a', logId: 'log-a' },
        view: { effectiveNow: `${TODAY}T12:00:00.000Z` },
    });
    return {
        timeline: createTimelineRepository(session),
        forecast: createForecastRepository(session),
        plannedDays: createPlannedDaysRepository(session),
        transactions: createTransactionRepository(session),
    };
}

describe('a plan a bank row looks like it paid', () => {
    const assets: Asset[] = [{ id: 'csob', amount: 50_000, link: 'bank', account_kind: 'current' }];
    const plan: Row = { id: 'rent', amount: -15_000, date: '2026-11-25', category: 'housing' };
    // The rent left the account early: the balance already shows it, and the bank row names the plan.
    const bankRow: Row = { id: 'bank-rent', amount: -15_000, date: '2026-11-20', status: 'archived', category: 'housing', plan_match: 'rent', bank_ref: 'csob:1' };
    const later: Row = { id: 'salary', amount: 40_000, date: '2026-11-28', category: 'income' };

    it('stops counting in the forecast, so the rent is not paid twice', async () => {
        const { timeline } = open([{ ...assets[0]!, amount: 35_000 }], [plan, bankRow, later]);
        const outlook = await timeline.getOutlook({ today: TODAY });
        expect(outlook).toMatchObject({ available: 35_000, end: 75_000, low: { amount: 35_000, date: TODAY } });
        expect(await timeline.getRange({ today: TODAY })).toEqual({ min: 35_000, max: 75_000 });
    });

    it('stays in the list, dimmed and without a running balance', async () => {
        const { timeline } = open([{ ...assets[0]!, amount: 35_000 }], [plan, bankRow, later]);
        const rows = await timeline.getRows({ today: TODAY, start: '2026-11-01', end: '2026-11-30', show: 'all' });
        expect(rows.map((row) => [row.id, row.kind, row.paused, row.balanceAfter])).toEqual([
            ['bank-rent', 'done', false, null],
            ['rent', 'planned', true, null],
            ['salary', 'planned', false, 75_000],
        ]);
    });

    it('is counted once in the month: the bank row as done, the plan not as planned', async () => {
        const { timeline } = open([{ ...assets[0]!, amount: 35_000 }], [plan, bankRow, later]);
        const [planned] = await timeline.getMonths({ today: TODAY, from: '2026-11-01', to: '2026-11-30', show: 'planned' });
        expect(planned).toMatchObject({ income: 40_000, expense: 0, start: 35_000, end: 75_000 });
        const [done] = await timeline.getMonths({ today: TODAY, from: '2026-11-01', to: '2026-11-30', show: 'done' });
        expect(done).toMatchObject({ income: 0, expense: -15_000 });
    });

    it('leaves the forecast, the planned days and the planning totals alike', async () => {
        const { forecast, plannedDays, transactions } = open([{ ...assets[0]!, amount: 35_000 }], [plan, bankRow, later]);
        const summary = await forecast.getForecastSummary(2026, 11, TODAY);
        expect(summary).toMatchObject({ first: 35_000, low: 35_000, monthEnd: 75_000 });
        expect((await plannedDays.plannedDays(TODAY, '2026-11-30', 10)).map((day) => day.day)).toEqual(['2026-11-28']);
        expect(await transactions.getPlanningSummary(TODAY, '2026-11-30')).toMatchObject({ plannedExpenses: 0, plannedIncome: 40_000 });
    });

    it('counts again once the match is declined', async () => {
        const { timeline } = open([{ ...assets[0]!, amount: 35_000 }], [plan, { ...bankRow, plan_match: '' }, later]);
        expect(await timeline.getOutlook({ today: TODAY })).toMatchObject({ end: 60_000, low: { amount: 20_000, date: '2026-11-25' } });
    });
});

describe('a move between own accounts', () => {
    const assets: Asset[] = [
        { id: 'csob', amount: 30_000, link: 'bank', account_kind: 'current' },
        { id: 'airbank', amount: 20_000, link: 'bank', account_kind: 'savings' },
    ];
    const done: Row[] = [
        { id: 'out', amount: -5_000, date: '2026-11-10', status: 'archived', category: 'transfer', transfer_id: 'move-1', asset_id: 'csob' },
        { id: 'in', amount: 5_000, date: '2026-11-11', status: 'archived', category: 'transfer', transfer_id: 'move-1', asset_id: 'airbank' },
        { id: 'groceries', amount: -800, date: '2026-11-12', status: 'archived', category: 'food' },
    ];
    // A planned card payment: money from the current account to the card, which leaves the sum unchanged.
    const planned: Row = { id: 'card-payment', amount: -7_000, date: '2026-11-27', category: 'transfer', asset_id: 'csob' };

    it('is neither income nor spending', async () => {
        const { timeline } = open(assets, [...done, planned]);
        const [month] = await timeline.getMonths({ today: TODAY, from: '2026-11-01', to: '2026-11-30', show: 'done' });
        expect(month).toMatchObject({ income: 0, expense: -800 });
        const [plans] = await timeline.getMonths({ today: TODAY, from: '2026-11-01', to: '2026-11-30', show: 'planned' });
        expect(plans).toMatchObject({ income: 0, expense: 0, start: 50_000, end: 50_000 });
    });

    it('moves no balance when planned', async () => {
        const { timeline, forecast } = open(assets, [...done, planned]);
        expect(await timeline.getOutlook({ today: TODAY })).toMatchObject({ available: 50_000, end: 50_000, endDate: null });
        const rows = await timeline.getRows({ today: TODAY, start: TODAY, end: '2026-11-30' });
        expect(rows.map((row) => [row.id, row.category, row.balanceAfter])).toEqual([['card-payment', 'transfer', null]]);
        expect((await forecast.getForecastSummary(2026, 11, TODAY)).monthEnd).toBe(50_000);
    });

    it('is never offered as a quick category', async () => {
        const { transactions } = open(assets, done);
        expect(await transactions.getTopCategories('2026-11-01', 'expense')).toEqual(['food']);
        expect(await transactions.getTopCategories('2026-11-01', 'income')).toEqual([]);
    });
});

describe('a credit card', () => {
    it('is an asset with a negative amount inside the one sum', async () => {
        const { timeline, forecast } = open([
            { id: 'csob', amount: 40_000, link: 'bank', account_kind: 'current' },
            { id: 'csob-card', amount: -6_500, link: 'bank', account_kind: 'card' },
            { id: 'cash', amount: 1_200 },
        ], [
            // A purchase on the card counts as spending on its day; the card's balance already shows it.
            { id: 'shoes', amount: -2_500, date: '2026-11-19', status: 'archived', category: 'shopping', asset_id: 'csob-card' },
            { id: 'insurance', amount: -3_000, date: '2026-11-26', category: 'housing' },
        ]);
        const outlook = await timeline.getOutlook({ today: TODAY });
        expect(outlook).toMatchObject({ available: 34_700, end: 31_700, low: { amount: 31_700, date: '2026-11-26' } });
        expect((await forecast.getForecastSummary(2026, 11, TODAY)).first).toBe(34_700);
        const [month] = await timeline.getMonths({ today: TODAY, from: '2026-11-01', to: '2026-11-30', show: 'done' });
        expect(month).toMatchObject({ expense: -2_500 });
    });
});
