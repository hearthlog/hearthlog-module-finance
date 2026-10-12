import type { ReadModelSession } from '@hearthlog/sdk/data';
import { withTimeout } from '@hearthlog/sdk/data';
import { endOfMonth, format, startOfMonth } from 'date-fns';
import { sql } from 'kysely';

export type ForecastPoint = { date: string; amount: number };

/** A forecast series plus the summary values charts and widgets render. */
export interface ForecastSummary {
    /** Full generated series, for charts. */
    points: ForecastPoint[];
    /** Points inside the requested month, for the Today sparkline. */
    monthPoints: ForecastPoint[];
    first: number;
    end: number;
    low: number;
    monthEnd: number;
    monthLow: number;
}

interface ForecastRow {
    date: string;
    amount: number | string | null;
    current_assets: number | string | null;
    forecast_end: number | string | null;
    forecast_low: number | string | null;
    month_end: number | string | null;
    month_low: number | string | null;
}

const FORECAST_ASSET_TYPE = 'asset';
const DB_TIMEOUT_MS = 5000;

function toNumber(value: number | string | bigint | null | undefined): number {
    const parsed = Number(value ?? 0);
    return Number.isFinite(parsed) ? parsed : 0;
}

function forecastRowsQuery(
    session: ReadModelSession,
    today: string,
    horizonEnd: string,
    monthStart: string,
    monthEnd: string,
) {
    return sql<ForecastRow>`
        WITH RECURSIVE days(day) AS (
            SELECT ${today}
            UNION ALL
            SELECT date(day, '+1 day') FROM days WHERE day < ${horizonEnd}
        ),
        asset_total AS (
            SELECT COALESCE(SUM(amount), 0) AS amount
            FROM ${session.table('assets')} AS assets
            WHERE asset_type = ${FORECAST_ASSET_TYPE}
        ),
        daily_plans AS (
            SELECT substr(trim(due_date), 1, 10) AS day, SUM(amount) AS amount
            FROM ${session.table('transactions')} AS transactions
            WHERE transaction_status = 'active'
                AND due_date >= ${today}
                AND due_date <= ${horizonEnd}
            GROUP BY substr(trim(due_date), 1, 10)
        ),
        forecast AS (
            SELECT
                days.day AS date,
                asset_total.amount + COALESCE(
                    SUM(COALESCE(daily_plans.amount, 0)) OVER (
                        ORDER BY days.day ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
                    ),
                    0
                ) AS amount,
                asset_total.amount AS current_assets
            FROM days
            CROSS JOIN asset_total
            LEFT JOIN daily_plans ON daily_plans.day = days.day
        )
        SELECT
            date,
            amount,
            current_assets,
            FIRST_VALUE(amount) OVER (ORDER BY date DESC) AS forecast_end,
            MIN(amount) OVER () AS forecast_low,
            (
                SELECT amount FROM forecast AS month_end_forecast
                WHERE month_end_forecast.date >= ${monthStart}
                    AND month_end_forecast.date <= ${monthEnd}
                ORDER BY month_end_forecast.date DESC
                LIMIT 1
            ) AS month_end,
            (
                SELECT MIN(amount) FROM forecast AS month_low_forecast
                WHERE month_low_forecast.date >= ${monthStart}
                    AND month_low_forecast.date <= ${monthEnd}
            ) AS month_low
        FROM forecast
        ORDER BY date
    `;
}

function monthForecastRowsQuery(
    session: ReadModelSession,
    today: string,
    horizonEnd: string,
    monthStart: string,
    monthEnd: string,
) {
    return sql<Pick<ForecastRow, 'date' | 'amount'>>`
        WITH RECURSIVE days(day) AS (
            SELECT ${today}
            UNION ALL
            SELECT date(day, '+1 day') FROM days WHERE day < ${horizonEnd}
        ),
        asset_total AS (
            SELECT COALESCE(SUM(amount), 0) AS amount
            FROM ${session.table('assets')} AS assets
            WHERE asset_type = ${FORECAST_ASSET_TYPE}
        ),
        daily_plans AS (
            SELECT substr(trim(due_date), 1, 10) AS day, SUM(amount) AS amount
            FROM ${session.table('transactions')} AS transactions
            WHERE transaction_status = 'active'
                AND due_date >= ${today}
                AND due_date <= ${horizonEnd}
            GROUP BY substr(trim(due_date), 1, 10)
        ),
        forecast AS (
            SELECT
                days.day AS date,
                asset_total.amount + COALESCE(
                    SUM(COALESCE(daily_plans.amount, 0)) OVER (
                        ORDER BY days.day ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
                    ),
                    0
                ) AS amount
            FROM days
            CROSS JOIN asset_total
            LEFT JOIN daily_plans ON daily_plans.day = days.day
        )
        SELECT date, amount
        FROM forecast
        WHERE date >= ${monthStart}
            AND date <= ${monthEnd}
        ORDER BY date
    `;
}

function forecastBounds(year: number, month: number, today: string) {
    const requestedMonth = new Date(year, month - 1, 1);
    const requestedMonthEnd = format(endOfMonth(requestedMonth), 'yyyy-MM-dd');
    return {
        horizonEnd: requestedMonthEnd < today ? today : requestedMonthEnd,
        monthStart: format(startOfMonth(requestedMonth), 'yyyy-MM-dd'),
        monthEnd: requestedMonthEnd,
    };
}

function toPoints(rows: Array<Pick<ForecastRow, 'date' | 'amount'>>): ForecastPoint[] {
    return rows.map((row) => ({ date: String(row.date), amount: toNumber(row.amount) }));
}

export function createForecastRepository(session: ReadModelSession) {
    return {
        async getForecast(year: number, month: number, today: string): Promise<ForecastPoint[]> {
            const { horizonEnd, monthStart, monthEnd } = forecastBounds(year, month, today);
            const result = await withTimeout(
                session.execute(forecastRowsQuery(session, today, horizonEnd, monthStart, monthEnd)),
                DB_TIMEOUT_MS,
                'Forecast query timed out',
            );
            return toPoints(result.rows);
        },

        /** Daily points and summary values, filtered and aggregated in SQLite. */
        async getForecastSummary(year: number, month: number, today: string): Promise<ForecastSummary> {
            const { horizonEnd, monthStart, monthEnd } = forecastBounds(year, month, today);
            const [forecastResult, monthResult] = await withTimeout(
                Promise.all([
                    session.execute(forecastRowsQuery(session, today, horizonEnd, monthStart, monthEnd)),
                    session.execute(monthForecastRowsQuery(session, today, horizonEnd, monthStart, monthEnd)),
                ]),
                DB_TIMEOUT_MS,
                'Forecast summary queries timed out',
            );
            const summary = forecastResult.rows[0];
            return {
                points: toPoints(forecastResult.rows),
                monthPoints: toPoints(monthResult.rows),
                first: toNumber(summary?.current_assets),
                end: toNumber(summary?.forecast_end),
                low: toNumber(summary?.forecast_low),
                monthEnd: toNumber(summary?.month_end),
                monthLow: toNumber(summary?.month_low),
            };
        },

        /** Full-year balance points for the static year-wide chart.
         *  Past dates show the actual balance (current assets minus all
         *  transactions that occurred after that date). Future dates show
         *  the forecast (current assets plus active planned transactions). */
        async getYearForecast(year: number, today: string): Promise<ForecastPoint[]> {
            const yearStart = format(new Date(year, 0, 1), 'yyyy-MM-dd');
            const yearEnd = format(new Date(year, 11, 31), 'yyyy-MM-dd');
            const pastEnd = yearEnd < today ? yearEnd : today;

            const query = sql<Pick<ForecastRow, 'date' | 'amount'>>`
                WITH RECURSIVE days(day) AS (
                    SELECT ${yearStart}
                    UNION ALL
                    SELECT date(day, '+1 day') FROM days WHERE day < ${yearEnd}
                ),
                asset_total AS (
                    SELECT COALESCE(SUM(amount), 0) AS amount
                    FROM ${session.table('assets')} AS assets
                    WHERE asset_type = ${FORECAST_ASSET_TYPE}
                ),
                year_start_balance AS (
                    SELECT
                        (SELECT amount FROM asset_total)
                        - COALESCE((
                            SELECT SUM(amount)
                            FROM ${session.table('transactions')}
                            WHERE due_date >= ${yearStart} AND due_date <= ${pastEnd}
                        ), 0) AS start_balance
                ),
                daily_effects AS (
                    SELECT substr(trim(due_date), 1, 10) AS day, SUM(amount) AS amount
                    FROM ${session.table('transactions')} AS transactions
                    WHERE
                        (due_date >= ${yearStart} AND due_date <= ${pastEnd})
                        OR (transaction_status = 'active' AND due_date > ${pastEnd} AND due_date <= ${yearEnd})
                    GROUP BY substr(trim(due_date), 1, 10)
                ),
                balance AS (
                    SELECT
                        days.day AS date,
                        (SELECT start_balance FROM year_start_balance)
                        + COALESCE(SUM(daily_effects.amount) OVER (
                            ORDER BY days.day ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
                        ), 0) AS amount
                    FROM days
                    LEFT JOIN daily_effects ON daily_effects.day = days.day
                )
                SELECT date, amount FROM balance ORDER BY date
            `;

            const result = await withTimeout(
                session.execute(query),
                DB_TIMEOUT_MS,
                'Year forecast query timed out',
            );
            return toPoints(result.rows);
        },
    };
}
