import { getDeviceSetting as kvGet, setDeviceSetting as kvSet } from '@hearthlog/sdk/runtime';
import type { AddTransactionEvent, BudgetItem } from '@hearthlog/sdk/data';

/**
 * Recurring rules connect Budget Plan items to the Cash Flow timeline.
 * Each rule lives in device KV keyed by budget item id (like the balance floor),
 * and generates real planned transactions when enabled or updated.
 */

export type RecurringCadence = 'monthly' | 'quarterly' | 'yearly';

export interface RecurringRule {
    enabled: boolean;
    cadence: RecurringCadence;
    /** 1..31; clamped to the last day of shorter months. */
    dayOfMonth: number;
}

export type RecurringRuleMap = Record<string, RecurringRule>;

const RULES_KEY = 'finance:recurring-rules';
const ACTIVE_PLAN_KEY = 'finance:active-budget-plan';

export function clampDayOfMonth(day: number): number {
    if (!Number.isFinite(day)) return 1;
    return Math.min(31, Math.max(1, Math.round(day)));
}

export function ordinalDay(day: number): string {
    const d = clampDayOfMonth(day);
    const mod100 = d % 100;
    if (mod100 >= 11 && mod100 <= 13) return `${d}th`;
    const mod10 = d % 10;
    if (mod10 === 1) return `${d}st`;
    if (mod10 === 2) return `${d}nd`;
    if (mod10 === 3) return `${d}rd`;
    return `${d}th`;
}

export function formatRecurringRule(rule: RecurringRule | null | undefined): string {
    if (!rule || !rule.enabled) return 'Plan only';
    const label = rule.cadence === 'monthly' ? 'Monthly' : rule.cadence === 'quarterly' ? 'Quarterly' : 'Yearly';
    return `${label} · ${ordinalDay(rule.dayOfMonth)}`;
}

function daysInMonth(year: number, monthIndex0: number): number {
    return new Date(year, monthIndex0 + 1, 0).getDate();
}

function formatYmd(year: number, monthIndex0: number, day: number): string {
    const mm = String(monthIndex0 + 1).padStart(2, '0');
    const dd = String(day).padStart(2, '0');
    return `${year}-${mm}-${dd}`;
}

/** Computes the next `count` ISO dates (`yyyy-MM-dd`) on or after `today`. */
export function nextRecurringDates(rule: RecurringRule, today: string, count = 3): string[] {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(today) || count <= 0) return [];
    const baseYear = Number(today.slice(0, 4));
    const baseMonth0 = Number(today.slice(5, 7)) - 1;
    const stepMonths = rule.cadence === 'monthly' ? 1 : rule.cadence === 'quarterly' ? 3 : 12;
    const targetDay = clampDayOfMonth(rule.dayOfMonth);

    const dates: string[] = [];
    let offset = 0;
    while (dates.length < count && offset < 120) {
        const totalMonths = baseYear * 12 + baseMonth0 + offset * stepMonths;
        const year = Math.floor(totalMonths / 12);
        const month0 = totalMonths % 12;
        const day = Math.min(targetDay, daysInMonth(year, month0));
        const iso = formatYmd(year, month0, day);
        if (iso >= today) dates.push(iso);
        offset += 1;
    }
    return dates;
}

export function occurrenceKey(name: string, date: string): string {
    return `${name.trim().toLowerCase()}::${date.slice(0, 10)}`;
}

/**
 * Builds idempotent `TRANSACTION_ADDED` events for upcoming occurrences of a recurring
 * budget item, skipping any date that already has a matching transaction on the timeline.
 */
export function buildRecurringEvents(
    item: Pick<BudgetItem, 'name' | 'amount' | 'item_type' | 'category'>,
    rule: RecurringRule,
    today: string,
    existingKeys: ReadonlySet<string>,
    occurrences = 3,
): AddTransactionEvent[] {
    if (!rule.enabled) return [];
    const signedAmount = item.item_type === 'income' ? Math.abs(Number(item.amount)) : -Math.abs(Number(item.amount));
    const dates = nextRecurringDates(rule, today, occurrences);
    const timestamp = Date.now();
    const events: AddTransactionEvent[] = [];

    for (const dueDate of dates) {
        if (existingKeys.has(occurrenceKey(item.name, dueDate))) continue;
        events.push({
            id: crypto.randomUUID(),
            type: 'TRANSACTION_ADDED',
            timestamp,
            payload: {
                id: crypto.randomUUID(),
                name: item.name,
                amount: signedAmount,
                due_date: dueDate,
                transaction_category: item.category || 'other',
                transaction_status: 'active',
                category_source: 'manual',
            },
        });
    }
    return events;
}

export async function loadRecurringRules(): Promise<RecurringRuleMap> {
    try {
        const raw = await kvGet<unknown>(RULES_KEY);
        if (!raw || typeof raw !== 'object') return {};
        const out: RecurringRuleMap = {};
        for (const [id, value] of Object.entries(raw as Record<string, unknown>)) {
            if (!value || typeof value !== 'object') continue;
            const candidate = value as Partial<RecurringRule>;
            const cadence: RecurringCadence =
                candidate.cadence === 'quarterly' || candidate.cadence === 'yearly' ? candidate.cadence : 'monthly';
            out[id] = {
                enabled: Boolean(candidate.enabled),
                cadence,
                dayOfMonth: clampDayOfMonth(Number(candidate.dayOfMonth ?? 1)),
            };
        }
        return out;
    } catch {
        return {};
    }
}

export function saveRecurringRules(rules: RecurringRuleMap): Promise<void> {
    return kvSet(RULES_KEY, rules);
}

export async function loadActiveBudgetPlanId(): Promise<string | null> {
    try {
        const value = await kvGet<unknown>(ACTIVE_PLAN_KEY);
        return typeof value === 'string' && value ? value : null;
    } catch {
        return null;
    }
}

export function saveActiveBudgetPlanId(planId: string): Promise<void> {
    return kvSet(ACTIVE_PLAN_KEY, planId);
}
