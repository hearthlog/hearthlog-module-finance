import type { BudgetItem, BudgetPlan } from '@hearthlog/sdk/data';
import type { ReadModelSession } from '@hearthlog/sdk/data';
import { withTimeout } from '@hearthlog/sdk/data';
import { sql } from 'kysely';

const DB_TIMEOUT_MS = 5000;

export interface BudgetPlanSummary extends BudgetPlan {
    income_total: number;
    expense_total: number;
    item_count: number;
}

/** Name or amount sorting for one budget section; absent means creation order. */
export type BudgetItemSort = 'name-asc' | 'name-desc' | 'amount-asc' | 'amount-desc';

/** Income, expenses and net of a picked selection, aggregated in SQLite. */
export interface BudgetItemSelectionSummary {
    count: number;
    incomeTotal: number;
    expenseTotal: number;
    /** Income minus expenses. */
    netTotal: number;
}

/** Reads the `incomeSort` / `expenseSort` URL value; anything unknown falls back to creation order. */
export function parseBudgetItemSort(value: string | null | undefined): BudgetItemSort | null {
    return value === 'name-asc' || value === 'name-desc' || value === 'amount-asc' || value === 'amount-desc'
        ? value
        : null;
}

function toNumber(value: number | string | bigint | null | undefined): number {
    const parsed = Number(value ?? 0);
    return Number.isFinite(parsed) ? parsed : 0;
}

export function createBudgetRepository(session: ReadModelSession) {
    return {
        async getPlans(): Promise<BudgetPlanSummary[]> {
            const result = await withTimeout(
                session.execute(sql<BudgetPlan & {
                    income_total: number | string | null;
                    expense_total: number | string | null;
                    item_count: number | string | null;
                }>`
                    SELECT plans.*,
                        COALESCE(SUM(CASE WHEN items.item_type = 'income' THEN items.amount ELSE 0 END), 0) AS income_total,
                        COALESCE(SUM(CASE WHEN items.item_type = 'expense' THEN items.amount ELSE 0 END), 0) AS expense_total,
                        COUNT(items.id) AS item_count
                    FROM ${session.table('budget_plans')} AS plans
                    LEFT JOIN ${session.table('budget_items')} AS items
                        ON items.tenant_id = plans.tenant_id
                        AND items.log_id = plans.log_id
                        AND items.plan_id = plans.id
                    GROUP BY plans.id
                    ORDER BY plans.created_at ASC, plans.id ASC
                `),
                DB_TIMEOUT_MS,
                'Budget plans query timed out',
            );
            return result.rows.map((row) => ({
                ...row,
                income_total: toNumber(row.income_total),
                expense_total: toNumber(row.expense_total),
                item_count: toNumber(row.item_count),
            }));
        },

        getPlanItems(planId: string, itemType: 'income' | 'expense', sort: BudgetItemSort | null = null): Promise<BudgetItem[]> {
            const items = session.selectFrom('budget_items')
                .selectAll()
                .where('plan_id', '=', planId)
                .where('item_type', '=', itemType);
            // Ordering stays in SQL so the page never re-sorts loaded rows in JavaScript.
            let ordered = items.orderBy('created_at', 'asc').orderBy('id', 'asc');
            if (sort === 'amount-asc') ordered = items.orderBy('amount', 'asc').orderBy('id', 'asc');
            else if (sort === 'amount-desc') ordered = items.orderBy('amount', 'desc').orderBy('id', 'asc');
            else if (sort === 'name-asc') ordered = items.orderBy(sql`name COLLATE NOCASE`, 'asc').orderBy('id', 'asc');
            else if (sort === 'name-desc') ordered = items.orderBy(sql`name COLLATE NOCASE`, 'desc').orderBy('id', 'asc');
            return withTimeout(
                ordered.execute(),
                DB_TIMEOUT_MS,
                'Budget items query timed out',
            );
        },

        /**
         * Income, expenses and net of a picked set of items. Selection totals are
         * aggregated in SQLite so the page never sums rows in JavaScript.
         */
        async getSelectionSummary(ids: string[]): Promise<BudgetItemSelectionSummary> {
            if (ids.length === 0) {
                return { count: 0, incomeTotal: 0, expenseTotal: 0, netTotal: 0 };
            }
            const result = await withTimeout(
                session.execute(sql<{
                    selected_count: number | string | null;
                    income_total: number | string | null;
                    expense_total: number | string | null;
                    net_total: number | string | null;
                }>`
                    SELECT
                        COUNT(*) AS selected_count,
                        COALESCE(SUM(CASE WHEN item_type = 'income' THEN amount ELSE 0 END), 0) AS income_total,
                        COALESCE(SUM(CASE WHEN item_type = 'expense' THEN amount ELSE 0 END), 0) AS expense_total,
                        COALESCE(SUM(CASE WHEN item_type = 'income' THEN amount ELSE -amount END), 0) AS net_total
                    FROM ${session.table('budget_items')} AS items
                    WHERE id IN (${sql.join(ids)})
                `),
                DB_TIMEOUT_MS,
                'Budget item selection summary timed out',
            );
            const row = result.rows[0];
            return {
                count: toNumber(row?.selected_count),
                incomeTotal: toNumber(row?.income_total),
                expenseTotal: toNumber(row?.expense_total),
                netTotal: toNumber(row?.net_total),
            };
        },
    };
}
