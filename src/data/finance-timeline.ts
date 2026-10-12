import { sql, type RawBuilder } from 'kysely';
import type { ReadModelSession } from '@hearthlog/sdk/data';
import { withTimeout } from '@hearthlog/sdk/data';
import type { TimelineKind, TimelineSection, TimelineShow } from '../finance/timeline.js';

/**
 * Reads for the endless Finance timeline. Every running balance, grouping,
 * low point and total is computed here in SQLite; the page only lays the rows
 * out and asks for the months that scroll into view.
 *
 * Balance model: current assets plus every plan. A plan is an active row
 * dated today or later. A row is done once it is marked done or its day has
 * passed: done rows are history that assets already reflect, so they never
 * move a balance. Balances therefore exist from today on only; after the last
 * plan they stay constant.
 */

const DB_TIMEOUT_MS = 5000;

export interface TimelineRow {
    id: string;
    name: string;
    amount: number;
    date: string;
    category: string;
    status: 'active' | 'archived';
    kind: TimelineKind;
    section: TimelineSection;
    /** Running balance after this row for plans; null for done rows. */
    balanceAfter: number | null;
    /** First visible row of its day within its section. */
    firstOfDay: boolean;
    /** The last plan of the day with the lowest balance ahead. */
    isLow: boolean;
}

export interface TimelineMonth {
    month: string;
    /** Income and expenses of the rows the month's header describes. */
    income: number;
    expense: number;
    /** Projected balance entering the month: available now up to today's month. */
    start: number;
    /** Projected balance after the month's plans. */
    end: number;
}

export interface TimelineOutlook {
    available: number;
    /** Lowest end-of-day balance across every plan ahead (today when nothing dips). */
    low: { amount: number; date: string };
    /** Balance after the last plan. */
    end: number;
    /** Day of the last plan; null when nothing is planned. */
    endDate: string | null;
    /** Day of the latest done row, which is ahead of today when marked done early; null when nothing is done. */
    lastDone: string | null;
}

export interface BalanceRange {
    min: number;
    max: number;
}

export interface TimelineRowsOptions {
    today: string;
    start: string;
    end: string;
    show?: TimelineShow;
    /** The lowest point is searched from today through this day (all plans when omitted). */
    lowThrough?: string;
    limit?: number;
}

const FAR_FUTURE = '9999-12-31';

function toNumber(value: unknown): number {
    const parsed = Number(value ?? 0);
    return Number.isFinite(parsed) ? parsed : 0;
}

function toNullableNumber(value: unknown): number | null {
    return value === null || value === undefined ? null : toNumber(value);
}

/** Shared CTEs: typed transactions and the current asset total. */
function baseCtes(session: ReadModelSession, today: string): RawBuilder<unknown> {
    return sql`
        typed AS (
            SELECT
                id,
                COALESCE(name, '') AS name,
                amount,
                substr(trim(due_date), 1, 10) AS day,
                COALESCE(NULLIF(transaction_category, ''), 'unknown') AS category,
                CASE WHEN transaction_status = 'archived' THEN 'archived' ELSE 'active' END AS status,
                CASE
                    WHEN transaction_status = 'archived' OR substr(trim(due_date), 1, 10) < ${today} THEN 'done'
                    ELSE 'planned'
                END AS kind,
                COALESCE(created_at, '') AS created_at
            FROM ${session.table('transactions')} AS transactions
        ),
        asset_total AS (
            SELECT COALESCE(SUM(amount), 0) AS amount
            FROM ${session.table('assets')} AS assets
            WHERE asset_type = 'asset'
        )`;
}

/** End-of-day balances on every day with plans. Must follow `WITH`. */
function dayEndCtes(session: ReadModelSession, today: string): RawBuilder<unknown> {
    return sql`
        ${baseCtes(session, today)},
        planned_days AS (
            SELECT day, SUM(amount) AS amount FROM typed WHERE kind = 'planned' GROUP BY day
        ),
        day_end AS (
            SELECT day, (SELECT amount FROM asset_total) + SUM(amount) OVER (
                ORDER BY day ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
            ) AS balance
            FROM planned_days
        )`;
}

export function createTimelineRepository(session: ReadModelSession) {
    return {
        /** Ordered rows for a window: done up to Today, then the rest with running balances for plans. */
        async getRows(options: TimelineRowsOptions): Promise<TimelineRow[]> {
            const { today, start, end, show = 'planned', limit } = options;
            const lowThrough = options.lowThrough ?? FAR_FUTURE;
            const result = await withTimeout(
                session.execute(sql<{
                    id: string; name: string; amount: unknown; date: string; category: string; status: string;
                    kind: TimelineKind; section: unknown; balance_after: unknown; first_of_day: unknown; is_low: unknown;
                }>`
                    WITH ${baseCtes(session, today)},
                    running AS (
                        SELECT
                            id,
                            day,
                            (SELECT amount FROM asset_total) + SUM(amount) OVER (
                                ORDER BY day, created_at, id ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
                            ) AS balance_after,
                            ROW_NUMBER() OVER (PARTITION BY day ORDER BY created_at DESC, id DESC) AS from_day_end
                        FROM typed
                        WHERE kind = 'planned' AND day <= max(${lowThrough}, ${end})
                    ),
                    low_day AS (
                        SELECT day FROM running
                        WHERE from_day_end = 1 AND day <= ${lowThrough} AND balance_after < (SELECT amount FROM asset_total)
                        ORDER BY balance_after ASC, day ASC
                        LIMIT 1
                    ),
                    placed AS (
                        SELECT
                            typed.*,
                            CASE WHEN typed.kind = 'done' AND typed.day <= ${today} THEN 0 ELSE 1 END AS section
                        FROM typed
                        WHERE (${show} = 'all' OR typed.kind = ${show}) AND typed.day >= ${start} AND typed.day <= ${end}
                    )
                    SELECT
                        placed.id,
                        placed.name,
                        placed.amount,
                        placed.day AS date,
                        placed.category,
                        placed.status,
                        placed.kind,
                        placed.section,
                        running.balance_after,
                        ROW_NUMBER() OVER (
                            PARTITION BY placed.section, placed.day ORDER BY placed.created_at, placed.id
                        ) = 1 AS first_of_day,
                        CASE WHEN running.from_day_end = 1 AND running.day = (SELECT day FROM low_day)
                            THEN 1 ELSE 0 END AS is_low
                    FROM placed
                    LEFT JOIN running ON running.id = placed.id
                    ORDER BY placed.section, placed.day, placed.created_at, placed.id
                    ${limit ? sql`LIMIT ${limit}` : sql``}
                `),
                DB_TIMEOUT_MS,
                'Timeline query timed out',
            );
            return result.rows.map((row) => ({
                id: String(row.id),
                name: String(row.name ?? ''),
                amount: toNumber(row.amount),
                date: String(row.date),
                category: String(row.category),
                status: row.status === 'archived' ? 'archived' : 'active',
                kind: row.kind,
                section: toNumber(row.section) as TimelineSection,
                balanceAfter: toNullableNumber(row.balance_after),
                firstOfDay: toNumber(row.first_of_day) === 1,
                isLow: toNumber(row.is_low) === 1,
            }));
        },

        /**
         * Income and expenses, and the projected balance around them, for every
         * month from `from` to `to`. The flows count what the month's header
         * describes: done rows under Done, plans under Planned, and under All
         * done rows before today's month and plans from it on.
         */
        async getMonths(options: { today: string; from: string; to: string; show?: TimelineShow }): Promise<TimelineMonth[]> {
            const { today, from, to, show = 'planned' } = options;
            const result = await withTimeout(
                session.execute(sql<{ month: string; income: unknown; expense: unknown; start_balance: unknown; end_balance: unknown }>`
                    WITH RECURSIVE ${baseCtes(session, today)},
                    months(month) AS (
                        SELECT substr(${from}, 1, 7)
                        UNION ALL
                        SELECT strftime('%Y-%m', date(month || '-01', '+1 month')) FROM months
                        WHERE month < substr(${to}, 1, 7)
                    ),
                    month_flows AS (
                        SELECT
                            substr(day, 1, 7) AS month,
                            SUM(CASE WHEN amount > 0 THEN amount ELSE 0 END) AS income,
                            SUM(CASE WHEN amount < 0 THEN amount ELSE 0 END) AS expense
                        FROM typed
                        WHERE day >= ${from} AND day <= ${to} AND CASE ${show}
                            WHEN 'all' THEN kind = 'planned' OR substr(day, 1, 7) < substr(${today}, 1, 7)
                            ELSE kind = ${show}
                        END
                        GROUP BY substr(day, 1, 7)
                    )
                    SELECT
                        months.month,
                        COALESCE(month_flows.income, 0) AS income,
                        COALESCE(month_flows.expense, 0) AS expense,
                        (SELECT amount FROM asset_total) + COALESCE((
                            SELECT SUM(amount) FROM typed WHERE kind = 'planned' AND substr(day, 1, 7) < months.month
                        ), 0) AS start_balance,
                        (SELECT amount FROM asset_total) + COALESCE((
                            SELECT SUM(amount) FROM typed WHERE kind = 'planned' AND substr(day, 1, 7) <= months.month
                        ), 0) AS end_balance
                    FROM months
                    LEFT JOIN month_flows ON month_flows.month = months.month
                    ORDER BY months.month
                `),
                DB_TIMEOUT_MS,
                'Timeline months query timed out',
            );
            return result.rows.map((month) => ({
                month: String(month.month),
                income: toNumber(month.income),
                expense: toNumber(month.expense),
                start: toNumber(month.start_balance),
                end: toNumber(month.end_balance),
            }));
        },

        /** Available now, the lowest balance across every plan ahead, the balance after the last plan and the latest done day. */
        async getOutlook(options: { today: string }): Promise<TimelineOutlook> {
            const { today } = options;
            const result = await withTimeout(
                session.execute(sql<{ available: unknown; low_amount: unknown; low_date: unknown; end_balance: unknown; end_date: unknown; last_done: unknown }>`
                    WITH ${dayEndCtes(session, today)},
                    lowest AS (
                        SELECT day, balance FROM day_end ORDER BY balance ASC, day ASC LIMIT 1
                    )
                    SELECT
                        (SELECT amount FROM asset_total) AS available,
                        CASE WHEN (SELECT balance FROM lowest) < (SELECT amount FROM asset_total)
                            THEN (SELECT balance FROM lowest) ELSE (SELECT amount FROM asset_total) END AS low_amount,
                        CASE WHEN (SELECT balance FROM lowest) < (SELECT amount FROM asset_total)
                            THEN (SELECT day FROM lowest) ELSE ${today} END AS low_date,
                        (SELECT amount FROM asset_total) + COALESCE((SELECT SUM(amount) FROM planned_days), 0) AS end_balance,
                        (SELECT MAX(day) FROM planned_days) AS end_date,
                        (SELECT MAX(day) FROM typed WHERE kind = 'done') AS last_done
                `),
                DB_TIMEOUT_MS,
                'Timeline outlook query timed out',
            );
            const row = result.rows[0];
            return {
                available: toNumber(row?.available),
                low: { amount: toNumber(row?.low_amount), date: row?.low_date ? String(row.low_date) : today },
                end: toNumber(row?.end_balance),
                endDate: row?.end_date ? String(row.end_date) : null,
                lastDone: row?.last_done ? String(row.last_done) : null,
            };
        },

        /** Lowest and highest balance from now through every plan: available now and each plan day's end. */
        async getRange(options: { today: string }): Promise<BalanceRange> {
            const { today } = options;
            const result = await withTimeout(
                session.execute(sql<{ min_balance: unknown; max_balance: unknown }>`
                    WITH ${dayEndCtes(session, today)}
                    SELECT
                        min(COALESCE((SELECT MIN(balance) FROM day_end), amount), amount) AS min_balance,
                        max(COALESCE((SELECT MAX(balance) FROM day_end), amount), amount) AS max_balance
                    FROM asset_total
                `),
                DB_TIMEOUT_MS,
                'Timeline range query timed out',
            );
            const row = result.rows[0];
            return { min: toNumber(row?.min_balance), max: toNumber(row?.max_balance) };
        },
    };
}
