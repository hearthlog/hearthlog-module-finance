import { describe, expect, it } from 'vitest';
import {
    buildRecurringEvents,
    formatRecurringRule,
    nextRecurringDates,
    occurrenceKey,
    ordinalDay,
    type RecurringRule,
} from './recurring.js';

describe('recurring budget rules', () => {
    it('formats ordinal days and rules cleanly', () => {
        expect(ordinalDay(1)).toBe('1st');
        expect(ordinalDay(2)).toBe('2nd');
        expect(ordinalDay(3)).toBe('3rd');
        expect(ordinalDay(11)).toBe('11th');
        expect(ordinalDay(22)).toBe('22nd');
        expect(formatRecurringRule({ enabled: true, cadence: 'monthly', dayOfMonth: 22 })).toBe('Monthly · 22nd');
        expect(formatRecurringRule({ enabled: false, cadence: 'monthly', dayOfMonth: 22 })).toBe('Plan only');
    });

    it('computes upcoming dates and clamps month lengths', () => {
        const rule: RecurringRule = { enabled: true, cadence: 'monthly', dayOfMonth: 31 };
        expect(nextRecurringDates(rule, '2026-01-15', 3)).toEqual([
            '2026-01-31',
            '2026-02-28',
            '2026-03-31',
        ]);
    });

    it('skips past day in current month and advances to next cadence period', () => {
        const monthly: RecurringRule = { enabled: true, cadence: 'monthly', dayOfMonth: 10 };
        expect(nextRecurringDates(monthly, '2026-11-22', 2)).toEqual(['2026-12-10', '2027-01-10']);

        const quarterly: RecurringRule = { enabled: true, cadence: 'quarterly', dayOfMonth: 15 };
        expect(nextRecurringDates(quarterly, '2026-11-22', 2)).toEqual(['2027-02-15', '2027-05-15']);
    });

    it('builds idempotent transaction events and skips existing occurrences', () => {
        const rule: RecurringRule = { enabled: true, cadence: 'monthly', dayOfMonth: 22 };
        const existing = new Set([occurrenceKey('Nájem bytu', '2026-11-22')]);
        const events = buildRecurringEvents(
            { name: 'Nájem bytu', amount: 24500, item_type: 'expense', category: 'housing' },
            rule,
            '2026-11-22',
            existing,
            3,
        );
        expect(events).toHaveLength(2);
        expect(events[0].payload.due_date).toBe('2026-12-22');
        expect(events[0].payload.amount).toBe(-24500);
        expect(events[1].payload.due_date).toBe('2027-01-22');
    });
});
