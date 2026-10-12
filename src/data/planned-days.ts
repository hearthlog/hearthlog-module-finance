import { sql } from 'kysely';
import { withTimeout, type ReadModelSession } from '@hearthlog/sdk/data';

const DB_TIMEOUT_MS = 5000;

export interface PlannedDay {
    /** `YYYY-MM-DD`. */
    day: string;
    count: number;
    total: number;
    /** The largest plans of the day, comma separated. */
    names: string;
}

function toCount(value: number | string | null | undefined): number {
    const count = Number(value ?? 0);
    return Number.isFinite(count) ? count : 0;
}

export function createPlannedDaysRepository(session: ReadModelSession) {
    return {
        /** Plans (active transactions) per day in `[from, until]`: how many, their net, and the largest names. */
        async plannedDays(from: string, until: string, limit: number): Promise<PlannedDay[]> {
            const result = await withTimeout(
                session.execute(sql<{ day: string; count: number | string; total: number | string | null; names: string | null }>`
                    WITH planned AS (
                        SELECT SUBSTR(TRIM(t.due_date), 1, 10) AS day,
                            COALESCE(NULLIF(TRIM(t.name), ''), 'Unnamed') AS name,
                            t.amount AS amount,
                            ROW_NUMBER() OVER (
                                PARTITION BY SUBSTR(TRIM(t.due_date), 1, 10)
                                ORDER BY ABS(t.amount) DESC, t.id
                            ) AS pos
                        FROM ${session.table('transactions')} AS t
                        WHERE t.transaction_status = 'active'
                            AND SUBSTR(TRIM(t.due_date), 1, 10) >= ${from}
                            AND SUBSTR(TRIM(t.due_date), 1, 10) <= ${until}
                    ), ranked AS (SELECT * FROM planned ORDER BY day, pos)
                    SELECT day, COUNT(*) AS count, SUM(amount) AS total,
                        GROUP_CONCAT(CASE WHEN pos <= 3 THEN name END, ', ') AS names
                    FROM ranked
                    GROUP BY day
                    ORDER BY day ASC
                    LIMIT ${limit}
                `),
                DB_TIMEOUT_MS,
                'Planned days query timed out',
            );
            return result.rows.map((row) => ({
                day: row.day,
                count: toCount(row.count),
                total: Number(row.total ?? 0),
                names: row.names ?? '',
            }));
        },
    };
}
