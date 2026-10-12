import type { Transaction } from '@hearthlog/sdk/data';
import type { ReadModelSession } from '@hearthlog/sdk/data';
import { withTimeout } from '@hearthlog/sdk/data';
import { sql } from 'kysely';

export type { Transaction };

const DB_TIMEOUT_MS = 5000;

/** Month totals the finance workbench renders, aggregated in SQLite. */
export interface TransactionMonthSummary {
    incomeTotal: number;
    expenseTotal: number;
    monthFlow: number;
    /** Active rows in the month, counted in SQL. */
    activeTransactionCount: number;
    activeDayCount: number;
    archivedCount: number;
}

/** Income, expenses and net of a picked selection, aggregated in SQLite. */
export interface TransactionSelectionSummary {
    count: number;
    incomeTotal: number;
    expenseTotal: number;
    netTotal: number;
}

/** The category the earlier, categorised rows of the same name lead to. */
export interface CategoryFromHistory {
    /** The name as asked, so callers match without normalising. */
    name: string;
    category: string;
    /** Rows of this name in the leading category. */
    count: number;
    /** The leading category's share of all categorised rows of this name. */
    share: number;
}

/** A history rule needs at least this many agreeing rows ... */
export const HISTORY_MIN_COUNT = 2;
/** ... and this share of all categorised rows of the name. */
export const HISTORY_MIN_SHARE = 0.8;

export interface DailyBalance {
    date: string;
    balance: number;
}

export interface PlanningSummary {
    plannedIncome: number;
    plannedExpenses: number;
    plannedFlow: number;
    plannedCount: number;
    plannedDayCount: number;
    pastDueCount: number;
    archivedCount: number;
}

function toNumber(value: number | string | bigint | null | undefined): number {
    const parsed = Number(value ?? 0);
    return Number.isFinite(parsed) ? parsed : 0;
}

function monthBounds(year: number, month: number): { startDate: string; endDate: string } {
    return {
        startDate: new Date(year, month - 1, 1).toISOString().slice(0, 10),
        endDate: new Date(year, month, 0).toISOString().slice(0, 10),
    };
}

export function createTransactionRepository(session: ReadModelSession) {
    return {
        getAllTransactions(): Promise<Transaction[]> {
            return withTimeout(
                session.selectFrom('transactions')
                    .selectAll()
                    .orderBy('due_date', 'asc')
                    .orderBy('created_at', 'asc')
                    .orderBy('id', 'asc')
                    .execute(),
                DB_TIMEOUT_MS,
                'getAllTransactions timed out',
            );
        },

        getTransactions(year: number, month: number): Promise<Transaction[]> {
            const { startDate, endDate } = monthBounds(year, month);
            return withTimeout(
                session.selectFrom('transactions')
                    .selectAll()
                    .where('due_date', '>=', startDate)
                    .where('due_date', '<=', endDate)
                    .orderBy('due_date', 'asc')
                    .orderBy('created_at', 'asc')
                    .orderBy('id', 'asc')
                    .execute(),
                DB_TIMEOUT_MS,
                'getTransactions timed out',
            );
        },

        /** Future plans in the selected horizon. Today remains planned until archived. */
        getPlannedTransactions(today: string, endDate: string): Promise<Transaction[]> {
            return withTimeout(
                session.selectFrom('transactions')
                    .selectAll()
                    .where('transaction_status', '=', 'active')
                    .where('due_date', '>=', today)
                    .where('due_date', '<=', endDate)
                    .orderBy('due_date', 'asc')
                    .orderBy('created_at', 'asc')
                    .orderBy('id', 'asc')
                    .execute(),
                DB_TIMEOUT_MS,
                'Planned transaction query timed out',
            );
        },

        getNextPlannedTransactions(today: string, endDate: string, limit = 5): Promise<Transaction[]> {
            return withTimeout(
                session.selectFrom('transactions')
                    .selectAll()
                    .where('transaction_status', '=', 'active')
                    .where('due_date', '>=', today)
                    .where('due_date', '<=', endDate)
                    .orderBy('due_date', 'asc')
                    .orderBy('created_at', 'asc')
                    .orderBy('id', 'asc')
                    .limit(limit)
                    .execute(),
                DB_TIMEOUT_MS,
                'Next planned transaction query timed out',
            );
        },

        /** Active entries whose date passed and now require an explicit decision. */
        getPastDueTransactions(today: string): Promise<Transaction[]> {
            return withTimeout(
                session.selectFrom('transactions')
                    .selectAll()
                    .where('transaction_status', '=', 'active')
                    .where('due_date', '<', today)
                    .orderBy('due_date', 'desc')
                    .orderBy('created_at', 'asc')
                    .orderBy('id', 'asc')
                    .execute(),
                DB_TIMEOUT_MS,
                'Past-due transaction query timed out',
            );
        },

        /** Completed entries for the selected archive month. */
        getArchivedTransactions(year: number, month: number): Promise<Transaction[]> {
            const { startDate, endDate } = monthBounds(year, month);
            return withTimeout(
                session.selectFrom('transactions')
                    .selectAll()
                    .where('transaction_status', '=', 'archived')
                    .where('due_date', '>=', startDate)
                    .where('due_date', '<=', endDate)
                    .orderBy('due_date', 'desc')
                    .orderBy('created_at', 'asc')
                    .orderBy('id', 'asc')
                    .execute(),
                DB_TIMEOUT_MS,
                'Archived transaction query timed out',
            );
        },

        /** Planning totals are calculated from future active entries only. */
        async getPlanningSummary(today: string, endDate: string): Promise<PlanningSummary> {
            const result = await withTimeout(
                session.execute(sql<{
                    planned_income: number | string | null;
                    planned_expenses: number | string | null;
                    planned_flow: number | string | null;
                    planned_count: number | string | null;
                    planned_day_count: number | string | null;
                    past_due_count: number | string | null;
                    archived_count: number | string | null;
                }>`
                    SELECT
                        SUM(CASE WHEN transaction_status = 'active' AND due_date >= ${today} AND due_date <= ${endDate} AND amount > 0 THEN amount ELSE 0 END) AS planned_income,
                        SUM(CASE WHEN transaction_status = 'active' AND due_date >= ${today} AND due_date <= ${endDate} AND amount < 0 THEN -amount ELSE 0 END) AS planned_expenses,
                        SUM(CASE WHEN transaction_status = 'active' AND due_date >= ${today} AND due_date <= ${endDate} THEN amount ELSE 0 END) AS planned_flow,
                        SUM(CASE WHEN transaction_status = 'active' AND due_date >= ${today} AND due_date <= ${endDate} THEN 1 ELSE 0 END) AS planned_count,
                        COUNT(DISTINCT CASE WHEN transaction_status = 'active' AND due_date >= ${today} AND due_date <= ${endDate} THEN substr(trim(due_date), 1, 10) END) AS planned_day_count,
                        SUM(CASE WHEN transaction_status = 'active' AND due_date < ${today} THEN 1 ELSE 0 END) AS past_due_count,
                        SUM(CASE WHEN transaction_status = 'archived' THEN 1 ELSE 0 END) AS archived_count
                    FROM ${session.table('transactions')} AS transactions
                `),
                DB_TIMEOUT_MS,
                'Planning summary query timed out',
            );
            const row = result.rows[0];
            return {
                plannedIncome: toNumber(row?.planned_income),
                plannedExpenses: toNumber(row?.planned_expenses),
                plannedFlow: toNumber(row?.planned_flow),
                plannedCount: toNumber(row?.planned_count),
                plannedDayCount: toNumber(row?.planned_day_count),
                pastDueCount: toNumber(row?.past_due_count),
                archivedCount: toNumber(row?.archived_count),
            };
        },

        async getSumOfTransactionAmountsUpToDate(date: string): Promise<number> {
            const result = await withTimeout(
                session.selectFrom('transactions')
                    .select(({ fn }) => fn.sum('amount').as('total_amount'))
                    .where('due_date', '<', date)
                    .where('transaction_status', '=', 'active')
                    .executeTakeFirst(),
                DB_TIMEOUT_MS,
                'getSumOfTransactionAmountsUpToDate timed out',
            );
            return toNumber(result?.total_amount);
        },

        /**
         * Income, expenses and net of a picked set of rows. Selection totals are
         * aggregated in SQLite so the page never sums rows in JavaScript.
         */
        async getSelectionSummary(ids: string[]): Promise<TransactionSelectionSummary> {
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
                        SUM(CASE WHEN amount > 0 THEN amount ELSE 0 END) AS income_total,
                        SUM(CASE WHEN amount < 0 THEN -amount ELSE 0 END) AS expense_total,
                        COALESCE(SUM(amount), 0) AS net_total
                    FROM ${session.table('transactions')} AS transactions
                    WHERE id IN (${sql.join(ids)})
                `),
                DB_TIMEOUT_MS,
                'Transaction selection summary timed out',
            );
            const row = result.rows[0];
            return {
                count: toNumber(row?.selected_count),
                incomeTotal: toNumber(row?.income_total),
                expenseTotal: toNumber(row?.expense_total),
                netTotal: toNumber(row?.net_total),
            };
        },

        /**
         * One balance per calendar day of the month, produced by SQLite with a
         * date series and a cumulative window sum over active daily totals.
         */
        async getMonthDailyBalances(
            year: number,
            month: number,
            openingBalance: number,
        ): Promise<DailyBalance[]> {
            const { startDate, endDate } = monthBounds(year, month);
            const result = await withTimeout(
                session.execute(sql<{ date: string; balance: number | string | null }>`
                    WITH RECURSIVE month_days(day) AS (
                        SELECT ${startDate}
                        UNION ALL
                        SELECT date(day, '+1 day') FROM month_days WHERE day < ${endDate}
                    ),
                    daily AS (
                        SELECT substr(trim(due_date), 1, 10) AS day, SUM(amount) AS amount
                        FROM ${session.table('transactions')} AS transactions
                        WHERE transaction_status = 'active'
                            AND due_date >= ${startDate}
                            AND due_date <= ${endDate}
                        GROUP BY day
                    )
                    SELECT month_days.day AS date,
                        ${openingBalance} + COALESCE(SUM(daily.amount) OVER (ORDER BY month_days.day), 0) AS balance
                    FROM month_days
                    LEFT JOIN daily ON daily.day = month_days.day
                    ORDER BY month_days.day
                `),
                DB_TIMEOUT_MS,
                'Month daily balance query timed out',
            );
            return result.rows.map((row) => ({
                date: String(row.date),
                balance: toNumber(row.balance),
            }));
        },

        /** Income, expenses, flow, active-day count and archived count in one pass. */
        async getMonthTransactionSummary(
            year: number,
            month: number,
        ): Promise<TransactionMonthSummary> {
            const { startDate, endDate } = monthBounds(year, month);
            const result = await withTimeout(
                session.execute(sql<{
                    income_total: number | string | null;
                    expense_total: number | string | null;
                    month_flow: number | string | null;
                    active_transaction_count: number | string | null;
                    active_day_count: number | string | null;
                    archived_count: number | string | null;
                }>`
                    SELECT
                        SUM(CASE WHEN transaction_status = 'active' AND amount > 0 THEN amount ELSE 0 END) AS income_total,
                        SUM(CASE WHEN transaction_status = 'active' AND amount < 0 THEN -amount ELSE 0 END) AS expense_total,
                        SUM(CASE WHEN transaction_status = 'active' THEN amount ELSE 0 END) AS month_flow,
                        SUM(CASE WHEN transaction_status = 'active' THEN 1 ELSE 0 END) AS active_transaction_count,
                        COUNT(DISTINCT CASE WHEN transaction_status = 'active' THEN substr(trim(due_date), 1, 10) END) AS active_day_count,
                        SUM(CASE WHEN transaction_status = 'archived' THEN 1 ELSE 0 END) AS archived_count
                    FROM ${session.table('transactions')} AS transactions
                    WHERE due_date >= ${startDate}
                        AND due_date <= ${endDate}
                `),
                DB_TIMEOUT_MS,
                'Month transaction summary query timed out',
            );
            const row = result.rows[0];
            return {
                incomeTotal: toNumber(row?.income_total),
                expenseTotal: toNumber(row?.expense_total),
                monthFlow: toNumber(row?.month_flow),
                activeTransactionCount: toNumber(row?.active_transaction_count),
                activeDayCount: toNumber(row?.active_day_count),
                archivedCount: toNumber(row?.archived_count),
            };
        },

        /**
         * The history rule: for each name, the category earlier rows of the
         * same name (case and surrounding spaces ignored) were given. Only
         * categorised rows count, and a name qualifies when at least
         * {@link HISTORY_MIN_COUNT} rows agree and the leading category holds
         * {@link HISTORY_MIN_SHARE} of them. Counting and ranking run in SQL.
         */
        async categoryFromHistory(names: string[]): Promise<CategoryFromHistory[]> {
            const wanted = [...new Set(names.map((name) => name.trim()).filter((name) => name !== ''))];
            if (wanted.length === 0) return [];
            const result = await withTimeout(
                session.execute(sql<{
                    name: string;
                    category: string;
                    count: number | string;
                    share: number | string;
                }>`
                    WITH wanted(name) AS (VALUES ${sql.join(wanted.map((name) => sql`(${name})`))}),
                    counts AS (
                        SELECT wanted.name AS name, transactions.transaction_category AS category, COUNT(*) AS count
                        FROM wanted
                        JOIN ${session.table('transactions')} AS transactions
                            ON lower(trim(transactions.name)) = lower(wanted.name)
                        WHERE COALESCE(transactions.transaction_category, '') NOT IN ('', 'unknown')
                        GROUP BY wanted.name, transactions.transaction_category
                    ),
                    ranked AS (
                        SELECT name, category, count,
                            SUM(count) OVER (PARTITION BY name) AS total,
                            ROW_NUMBER() OVER (PARTITION BY name ORDER BY count DESC, category ASC) AS place
                        FROM counts
                    )
                    SELECT name, category, count, CAST(count AS REAL) / total AS share
                    FROM ranked
                    WHERE place = 1
                        AND count >= ${HISTORY_MIN_COUNT}
                        AND CAST(count AS REAL) / total >= ${HISTORY_MIN_SHARE}
                `),
                DB_TIMEOUT_MS,
                'Category history query timed out',
            );
            return result.rows.map((row) => ({
                name: String(row.name),
                category: String(row.category),
                count: toNumber(row.count),
                share: toNumber(row.share),
            }));
        },

        /** Rows of a month (`start` to `end`, whole days) that still have no category, oldest first. */
        getUncategorizedInMonth(start: string, end: string): Promise<Transaction[]> {
            return withTimeout(
                session.selectFrom('transactions')
                    .selectAll()
                    .where(sql<boolean>`COALESCE(transaction_category, '') IN ('', 'unknown')`)
                    .where(sql<boolean>`substr(trim(due_date), 1, 10) BETWEEN ${start} AND ${end}`)
                    .orderBy('due_date', 'asc')
                    .orderBy('created_at', 'asc')
                    .orderBy('id', 'asc')
                    .execute(),
                DB_TIMEOUT_MS,
                'Uncategorized transaction query timed out',
            );
        },

        /** How many rows of the month still have no category. */
        async countUncategorizedInMonth(start: string, end: string): Promise<number> {
            const result = await withTimeout(
                session.selectFrom('transactions')
                    .select(({ fn }) => fn.countAll().as('count'))
                    .where(sql<boolean>`COALESCE(transaction_category, '') IN ('', 'unknown')`)
                    .where(sql<boolean>`substr(trim(due_date), 1, 10) BETWEEN ${start} AND ${end}`)
                    .executeTakeFirst(),
                DB_TIMEOUT_MS,
                'Uncategorized transaction count timed out',
            );
            return toNumber(result?.count);
        },

        /** The categories used most on or after a day for one direction, most used first (phone category chips). */
        async getTopCategories(since: string, direction: 'income' | 'expense', limit = 4): Promise<string[]> {
            const rows = await withTimeout(
                session.selectFrom('transactions')
                    .select(['transaction_category as category', ({ fn }) => fn.countAll().as('uses')])
                    .where(sql<boolean>`COALESCE(transaction_category, '') NOT IN ('', 'unknown')`)
                    .where(sql<boolean>`substr(trim(due_date), 1, 10) >= ${since}`)
                    .where(direction === 'income' ? sql<boolean>`amount > 0` : sql<boolean>`amount < 0`)
                    .groupBy('transaction_category')
                    .orderBy('uses', 'desc')
                    .orderBy('transaction_category', 'asc')
                    .limit(limit)
                    .execute(),
                DB_TIMEOUT_MS,
                'Top categories query timed out',
            );
            return rows.map((row) => String(row.category));
        },

        /** The most recently updated active rows of a month, chosen in SQL. */
        getRecentActiveTransactions(year: number, month: number, limit = 5): Promise<Transaction[]> {
            const { startDate, endDate } = monthBounds(year, month);
            return withTimeout(
                session.selectFrom('transactions')
                    .selectAll()
                    .where('transaction_status', '=', 'active')
                    .where('due_date', '>=', startDate)
                    .where('due_date', '<=', endDate)
                    .orderBy('updated_at', 'desc')
                    .orderBy('id', 'asc')
                    .limit(limit)
                    .execute(),
                DB_TIMEOUT_MS,
                'Recent active transaction query timed out',
            );
        },
    };
}
