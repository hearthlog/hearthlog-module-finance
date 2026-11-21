import { addDays, format, parseISO, subDays } from 'date-fns';
import { queryDatabase, type Transaction } from '@hearthlog/sdk/data';
import { matchPlans, type MatchPlan, type MatchRow } from './matching.js';
import { recordMatches, run } from './review-commands.js';

/**
 * Checks bank rows nobody has checked yet against the open plans and records the outcome on each row: the plan it
 * probably paid (which pauses that plan), or `none`. It runs in the browser because only the read model knows the
 * plans; every device computes the same answer, so two devices doing it at once write the same values.
 */

export function toMatchRow(row: Transaction): MatchRow {
    return {
        id: row.id,
        amount: Number(row.amount),
        date: row.due_date.slice(0, 10),
        name: row.name ?? '',
        bankText: row.bank_text ?? '',
        assetId: row.asset_id ?? '',
        counterparty: row.counterparty ?? '',
    };
}

export function toMatchPlan(plan: Transaction): MatchPlan {
    return {
        id: plan.id,
        amount: Number(plan.amount),
        date: plan.due_date.slice(0, 10),
        name: plan.name ?? '',
        category: plan.transaction_category,
        assetId: plan.asset_id ?? '',
    };
}

let running: Promise<number> | null = null;

/** Records matches for every unchecked bank row; resolves to how many rows got a plan. One pass at a time. */
export function runMatchingPass(): Promise<number> {
    running ??= (async () => {
        try {
            const rows = (await queryDatabase((repositories) => repositories.transactions.getReviewRows()))
                .filter((row) => !row.plan_match);
            if (rows.length === 0) return 0;
            const dates = rows.map((row) => row.due_date.slice(0, 10)).sort();
            const from = format(subDays(parseISO(dates[0]!), 5), 'yyyy-MM-dd');
            const to = format(addDays(parseISO(dates.at(-1)!), 5), 'yyyy-MM-dd');
            const [plans, confirmed] = await queryDatabase((repositories) => Promise.all([
                repositories.transactions.getOpenPlans(from, to),
                repositories.transactions.confirmedNames(rows.map((row) => row.bank_text ?? '')),
            ]));
            const matches = matchPlans(rows.map(toMatchRow), plans.map(toMatchPlan), (text) => new Set(confirmed[text] ?? []));
            await run(recordMatches(matches));
            return matches.filter((match) => match.planId !== 'none').length;
        } finally {
            running = null;
        }
    })();
    return running;
}
