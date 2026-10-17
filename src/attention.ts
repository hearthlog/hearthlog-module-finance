import { addDays, format } from 'date-fns';
import type { AttentionContribution, AttentionReminder } from '@hearthlog/contracts';
import { queryDatabase } from '@hearthlog/sdk/data';
import { formatMoney } from '@hearthlog/sdk/format';
import { REMINDER_HOUR } from '@hearthlog/sdk/runtime';
import type { PlannedDay } from './data/planned-days.js';

/** How far ahead plans are scheduled; the shell keeps the nearest 60. */
const PLAN_HORIZON_DAYS = 14;
const DAY = 'yyyy-MM-dd';

/** Rows arrive already grouped by SQL; this only words them: one note per day with plans. */
export function planReminders(days: readonly PlannedDay[]): AttentionReminder[] {
    return days.map((day) => {
        const more = day.count - Math.min(day.count, 3);
        return day.count === 1
            ? {
                id: `plans:${day.day}`,
                title: `Planned today: ${day.names || 'Plan'}`,
                body: formatMoney(day.total),
                at: `${day.day}T${REMINDER_HOUR}`,
                path: '/finance',
            }
            : {
                id: `plans:${day.day}`,
                title: `${day.count} plans today`,
                body: more > 0 ? `${day.names} and ${more} more` : day.names,
                at: `${day.day}T${REMINDER_HOUR}`,
                path: '/finance',
            };
    });
}

/** Plans waiting for a decision remind on their day; the sidebar shows what is available now. */
export const attention: AttentionContribution = {
    async figures({ today }) {
        const outlook = await queryDatabase((repositories) => repositories.timeline.getOutlook({ today }));
        // Nothing recorded yet: no figure rather than a zero.
        if (outlook.available === 0) return [];
        const money = formatMoney(outlook.available, { decimals: 'never' });
        return [{ id: 'finance', text: money, label: `${money} available now` }];
    },
    async reminders({ today }) {
        const days = await queryDatabase((repositories) =>
            repositories.plannedDays.plannedDays(format(today, DAY), format(addDays(today, PLAN_HORIZON_DAYS), DAY), PLAN_HORIZON_DAYS + 1));
        return planReminders(days);
    },
};
