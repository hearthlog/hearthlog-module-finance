import { afterEach, describe, expect, it } from 'vitest';
import { DatabaseSync, type SQLInputValue, type StatementSync } from 'node:sqlite';
import { Kysely, SqliteDialect } from 'kysely';
import { TRANSACTION_DDL } from '@hearthlog/sdk/data';
import { createReadModelSession, type ReadModelDatabase } from '@hearthlog/sdk/testing';
import { createTransactionRepository } from './transactions.js';

/**
 * The history rule suggests a category from earlier rows of the same name. It
 * must count categorised rows only, stay inside the active tenant and log, and
 * never suggest from thin or split history.
 */

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

type Seed = [name: string, category: string, date?: string, tenant?: string, log?: string];

function repository(seed: Seed[]) {
    const sqlite = new DatabaseSync(':memory:');
    sqlite.exec(TRANSACTION_DDL);
    const insert = sqlite.prepare(
        'INSERT INTO transactions (tenant_id, log_id, id, name, amount, due_date, transaction_category) VALUES (?, ?, ?, ?, ?, ?, ?)',
    );
    seed.forEach(([name, category, date = '2026-09-10', tenant = 'tenant-a', log = 'log-a'], index) => {
        insert.run(tenant, log, `t${index}`, name, -10, date, category);
    });
    const db = new Kysely<ReadModelDatabase>({
        dialect: new SqliteDialect({ database: { close: () => sqlite.close(), prepare: (query: string) => wrap(sqlite.prepare(query), query) } as never }),
    });
    databases.push(db);
    return createTransactionRepository(createReadModelSession(db, {
        schema: 'main',
        scope: { tenantId: 'tenant-a', logId: 'log-a' },
        view: { effectiveNow: '2026-09-14T12:00:00.000Z' },
    }));
}

describe('categoryFromHistory', () => {
    it('matches names ignoring case and spaces, and stays quiet below 80 %', async () => {
        const rows = repository([['Albert', 'food'], ['albert ', 'food'], ['ALBERT', 'food'], ['Albert', 'shopping']]);
        expect(await rows.categoryFromHistory(['Albert'])).toEqual([]);
        const agreed = repository([['Albert', 'food'], ['albert ', 'food']]);
        expect(await agreed.categoryFromHistory(['Albert'])).toEqual([{ name: 'Albert', category: 'food', count: 2, share: 1 }]);
    });

    it('needs the leading category to hold 80 % of the categorised rows', async () => {
        const settled = repository([['Albert', 'food'], ['Albert', 'food'], ['Albert', 'food'], ['Albert', 'food'], ['Albert', 'shopping']]);
        expect(await settled.categoryFromHistory(['albert'])).toEqual([
            { name: 'albert', category: 'food', count: 4, share: 0.8 },
        ]);
    });

    it('ignores uncategorised rows, thin history and other logs', async () => {
        const rows = repository([
            ['Billa', 'food'],
            ['Tesco', 'unknown'], ['Tesco', 'unknown'], ['Tesco', ''],
            ['Rent', 'housing', '2026-09-01', 'tenant-a', 'log-b'], ['Rent', 'housing', '2026-09-01', 'tenant-b', 'log-a'],
            ['Rent', 'housing', '2026-09-01', 'tenant-b', 'log-b'],
        ]);
        expect(await rows.categoryFromHistory(['Billa', 'Tesco', 'Rent'])).toEqual([]);
    });

    it('answers many names at once and matches Czech names exactly', async () => {
        const rows = repository([
            ['Řezník', 'food'], ['Řezník', 'food'],
            ['Shell', 'transport'], ['shell', 'transport'],
        ]);
        const result = await rows.categoryFromHistory(['Řezník', 'Shell', 'Unknown shop']);
        expect(result.map((entry) => [entry.name, entry.category]).sort()).toEqual([['Shell', 'transport'], ['Řezník', 'food']]);
    });
});

describe('uncategorized rows of a month', () => {
    const seed: Seed[] = [
        ['A', 'unknown', '2026-09-01'], ['B', '', '2026-09-30T10:00:00'], ['C', 'food', '2026-09-15'],
        ['D', 'unknown', '2026-10-01'], ['E', 'unknown', '2026-08-31'],
    ];

    it('lists and counts the month\'s rows without a category, including the last day', async () => {
        const rows = repository(seed);
        expect((await rows.getUncategorizedInMonth('2026-09-01', '2026-09-30')).map((row) => row.name)).toEqual(['A', 'B']);
        expect(await rows.countUncategorizedInMonth('2026-09-01', '2026-09-30')).toBe(2);
    });
});

describe('plans and done rows of a month', () => {
    it('counts rows dated before today as done and the rest as plans', async () => {
        const rows = repository([
            ['A', 'food', '2026-09-01'], ['B', 'food', '2026-09-14'], ['C', 'food', '2026-09-15'],
            ['D', 'food', '2026-09-30T10:00:00'], ['E', 'food', '2026-10-01'],
        ]);
        expect(await rows.countKindsInMonth('2026-09-01', '2026-09-30', '2026-09-15')).toEqual({ planned: 2, done: 2 });
        expect(await rows.countKindsInMonth('2026-11-01', '2026-11-30', '2026-09-15')).toEqual({ planned: 0, done: 0 });
    });
});
