import { describe, expect, it } from 'vitest';
import { accountReminders, reviewBadge } from './attention.js';

describe('review backlog', () => {
    it('stays quiet for three days, then badges Transactions with the count', () => {
        expect(reviewBadge({ pending: 5, oldest: '2026-11-18' }, '2026-11-21')).toEqual([]);
        expect(reviewBadge({ pending: 5, oldest: '2026-11-17' }, '2026-11-21')).toEqual([
            { ids: ['finance', 'transactions'], count: 5, tone: 'warning', label: '5 bank rows to review' },
        ]);
        expect(reviewBadge({ pending: 0, oldest: null }, '2026-11-21')).toEqual([]);
    });
});

describe('account reminders', () => {
    const now = new Date('2026-11-15T09:00:00Z');
    it('ask about a quiet email account and an ending approval, not about a fresh one', () => {
        const reminders = accountReminders([
            { id: 'air', name: 'Air Bank', amount: 12_480, link: 'bank', provider: 'email', connection_id: 'c2', synced_at: '2026-11-06T08:00:00Z' },
            { id: 'csob', name: 'ČSOB', amount: 84_310, link: 'bank', provider: 'email', connection_id: 'c1', synced_at: '2026-11-15T08:30:00Z' },
            { id: 'eur', name: 'Revolut EUR', amount: 10_020, link: 'bank', provider: 'enable_banking', connection_id: 'c3', synced_at: '2026-11-15T07:00:00Z' },
        ], [
            { id: 'c1', bank: 'csob', provider: 'email' },
            { id: 'c2', bank: 'airbank', provider: 'email' },
            { id: 'c3', bank: 'revolut', provider: 'enable_banking', valid_until: '2026-11-29T00:00:00Z' },
        ], now);
        expect(reminders.map((reminder) => [reminder.id, reminder.title])).toEqual([
            ['quiet:air:6 Nov', 'Nothing from Air Bank since 6 Nov'],
            ['approval:eur:renew', 'Revolut approval ends soon'],
        ]);
    });
});
