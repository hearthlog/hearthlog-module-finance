import { BucketStore } from '@hearthlog/sdk/endless';
import { queryDatabase } from '@hearthlog/sdk/data';
import type { TimelineMonth, TimelineRow } from '../../data/finance-timeline.js';
import { monthWindow, type TimelineShow } from '../../finance/timeline.js';

export interface MonthData {
    key: string;
    stats: TimelineMonth;
    /** SQL-ordered rows of the kind shown. */
    rows: TimelineRow[];
}

/**
 * Loaded months of the endless timeline. Each batch of months that scroll
 * into view is one SQL session: month totals plus rows per month.
 */
export class TimelineMonths extends BucketStore<MonthData> {
    constructor(params: () => { today: string; show: TimelineShow }) {
        super(async (keys) => {
            const { today, show } = params();
            const result = await queryDatabase(async (repositories) => {
                const [stats, ...rows] = await Promise.all([
                    repositories.timeline.getMonths({ today, from: monthWindow(keys[0]).start, to: monthWindow(keys[keys.length - 1]).end, show }),
                    ...keys.map((key) => repositories.timeline.getRows({ today, ...monthWindow(key), show })),
                ]);
                return { stats, rows };
            });
            const statsByMonth = new Map(result.stats.map((month) => [month.month, month]));
            const months = new Map<string, MonthData>();
            keys.forEach((key, index) => {
                const stats = statsByMonth.get(key);
                if (stats) months.set(key, { key, stats, rows: result.rows[index] });
            });
            return months;
        }, '[Finance] Could not load timeline months');
    }
}
