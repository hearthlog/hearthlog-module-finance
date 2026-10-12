import { afterEach, describe, expect, it } from 'vitest';
import { createProjectionTestDatabase, type ProjectionTestDatabase } from '@hearthlog/sdk/testing';

const open: ProjectionTestDatabase[] = [];
afterEach(async () => {
    await Promise.all(open.splice(0).map((fixture) => fixture.destroy()));
});

describe('transaction category provenance', () => {
    it('keeps category_source from the add, replaces it on a sort, and keeps it across unrelated updates', async () => {
        const db = createProjectionTestDatabase({ tables: ['transactions'] });
        open.push(db);
        const entityId = 'transaction:tx-1';
        const row = () => db.sqlite.prepare('SELECT transaction_category AS category, category_source AS source FROM transactions').get();
        const event = (id: string, type: 'TRANSACTION_ADDED' | 'TRANSACTION_UPDATED', version: number, payload: Record<string, unknown>) =>
            db.addEvent({ id, type, timestamp: version * 1_000, entityId, entityVersion: version, logVersion: version, payload: { id: 'tx-1', ...payload } });

        // A row saved before provenance existed has no source.
        event('add', 'TRANSACTION_ADDED', 1, { name: 'Albert', amount: -120 });
        await db.project('transaction', [entityId]);
        expect(row()).toEqual({ category: 'unknown', source: '' });

        event('sort', 'TRANSACTION_UPDATED', 2, { transaction_category: 'food', category_source: 'ai:@cf/cloudflare/clef-flash' });
        await db.project('transaction', [entityId]);
        expect(row()).toEqual({ category: 'food', source: 'ai:@cf/cloudflare/clef-flash' });

        event('move', 'TRANSACTION_UPDATED', 3, { due_date: '2026-10-05' });
        await db.project('transaction', [entityId]);
        expect(row()).toEqual({ category: 'food', source: 'ai:@cf/cloudflare/clef-flash' });

        // Undo writes the earlier values back explicitly.
        event('undo', 'TRANSACTION_UPDATED', 4, { transaction_category: 'unknown', category_source: '' });
        await db.project('transaction', [entityId]);
        expect(row()).toEqual({ category: 'unknown', source: '' });
    });
});
