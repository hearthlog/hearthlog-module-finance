import { addDays, differenceInCalendarDays, format, parseISO } from 'date-fns';
import type { AttentionBadge, AttentionContribution, AttentionReminder } from '@hearthlog/contracts';
import { queryDatabase } from '@hearthlog/sdk/data';
import { formatMoney } from '@hearthlog/sdk/format';
import { REMINDER_HOUR } from '@hearthlog/sdk/runtime';
import type { PlannedDay } from './data/planned-days.js';
import { summarizeAccount, type AccountAsset, type AccountConnection } from './finance/accounts.js';

/** Bank rows may wait this many days before the Transactions entry carries a badge. */
export const REVIEW_GRACE_DAYS = 3;

/** A badge once the oldest bank row has waited longer than the grace days. */
export function reviewBadge(backlog: { pending: number; oldest: string | null }, today: string): AttentionBadge[] {
    if (!backlog.pending || !backlog.oldest || differenceInCalendarDays(parseISO(today), parseISO(backlog.oldest)) <= REVIEW_GRACE_DAYS) return [];
    return [{ ids: ['finance', 'transactions'], count: backlog.pending, tone: 'warning', label: `${backlog.pending} bank ${backlog.pending === 1 ? 'row' : 'rows'} to review` }];
}

/** One reminder per account that went quiet (email) or whose approval ends soon, worded as the States board does. */
export function accountReminders(assets: readonly AccountAsset[], connections: readonly AccountConnection[], now: Date): AttentionReminder[] {
    const at = `${format(now, DAY)}T${REMINDER_HOUR}`;
    return assets.flatMap((asset) => {
        const account = summarizeAccount(asset, connections.find((connection) => connection.id === asset.connection_id) ?? null, now);
        const bank = account.bank?.name ?? 'the bank';
        if (account.state === 'quiet') {
            const since = asset.synced_at ? format(parseISO(asset.synced_at), 'd MMM') : '';
            return [{ id: `quiet:${asset.id}:${since}`, title: `Nothing from ${bank} since ${since}`, body: `Check the balance of ${account.name}`, at, path: '/finance' }];
        }
        if (account.state === 'renew' || account.state === 'expired') {
            return [{ id: `approval:${asset.id}:${account.state}`, title: account.state === 'renew' ? `${bank} approval ends soon` : `${bank} stopped syncing`, body: account.stamp, at, path: '/finance' }];
        }
        return [];
    });
}

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
    async badges({ today }) {
        const backlog = await queryDatabase((repositories) => repositories.transactions.reviewBacklog());
        return reviewBadge(backlog, today);
    },
    async figures({ today }) {
        const outlook = await queryDatabase((repositories) => repositories.timeline.getOutlook({ today }));
        // Nothing recorded yet: no figure rather than a zero.
        if (outlook.available === 0) return [];
        const money = formatMoney(outlook.available, { decimals: 'never' });
        return [{ id: 'finance', text: money, label: `${money} available now` }];
    },
    async reminders({ today }) {
        const [days, assets, connections] = await queryDatabase((repositories) => Promise.all([
            repositories.plannedDays.plannedDays(format(today, DAY), format(addDays(today, PLAN_HORIZON_DAYS), DAY), PLAN_HORIZON_DAYS + 1),
            repositories.assets.getAssetsByType('asset'),
            repositories.assets.getBankConnections(),
        ]));
        return [...planReminders(days), ...accountReminders(assets, connections, today)];
    },
};
