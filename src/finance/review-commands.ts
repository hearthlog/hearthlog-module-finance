/**
 * The review decisions, each built as the events it writes and the events that undo it, so a decision is one local
 * command and its Undo another. The builders are pure (tests apply them to a database and check the forecast); `run`
 * sends them.
 */

import {
    executeLocalCommand,
    type AddTransactionEvent,
    type RemoveTransactionEvent,
    type Transaction,
    type UpdateAssetEvent,
    type UpdateTransactionEvent,
} from '@hearthlog/sdk/data';
import { stableUuid } from './bank-ids.js';
import { NO_MATCH, NOT_A_TRANSFER } from './matching.js';

export type ReviewEvent = AddTransactionEvent | UpdateTransactionEvent | RemoveTransactionEvent | UpdateAssetEvent;

export interface Decision {
    events: ReviewEvent[];
    undo: ReviewEvent[];
}

type Row = Pick<Transaction, 'id' | 'name' | 'amount' | 'due_date' | 'transaction_category' | 'category_source' | 'review' | 'plan_match' | 'transfer_id' | 'asset_id'>;

const now = () => Date.now();
const id = () => crypto.randomUUID();

function update(payload: UpdateTransactionEvent['payload']): UpdateTransactionEvent {
    return { id: id(), type: 'TRANSACTION_UPDATED', timestamp: now(), payload };
}

/** What a row looked like, to put back on Undo. */
function previous(row: Row): UpdateTransactionEvent['payload'] {
    return {
        id: row.id,
        name: row.name ?? '',
        transaction_category: row.transaction_category,
        category_source: row.category_source,
        review: row.review,
        plan_match: row.plan_match,
        transfer_id: row.transfer_id,
    };
}

/**
 * The plan is paid: the bank row keeps its amount and day and takes the plan's name and category, and the plan goes.
 * Undo puts the plan back (as a new entity with the same values) and makes the row suggest it again.
 */
export function confirmPlan(row: Row, plan: Row): Decision {
    const restoredPlanId = id();
    return {
        events: [
            update({ id: row.id, name: plan.name ?? row.name ?? '', transaction_category: plan.transaction_category, category_source: 'manual', review: 'reviewed', plan_match: NO_MATCH }),
            { id: id(), type: 'TRANSACTION_REMOVED', timestamp: now(), payload: { id: plan.id } },
        ],
        undo: [
            {
                id: id(),
                type: 'TRANSACTION_ADDED',
                timestamp: now(),
                payload: {
                    id: restoredPlanId,
                    name: plan.name ?? '',
                    amount: plan.amount,
                    due_date: plan.due_date,
                    transaction_status: 'active',
                    transaction_category: plan.transaction_category,
                    category_source: plan.category_source,
                    ...(plan.asset_id ? { asset_id: plan.asset_id } : {}),
                },
            },
            update({ ...previous(row), plan_match: restoredPlanId }),
        ],
    };
}

/** Not this one: the plan counts in the forecast again and the row is its own transaction. */
export function declinePlan(row: Row): Decision {
    return {
        events: [update({ id: row.id, plan_match: NO_MATCH })],
        undo: [update({ id: row.id, plan_match: row.plan_match })],
    };
}

export async function transferIdFor(...rowIds: string[]): Promise<string> {
    return stableUuid('finance-transfer', ...[...rowIds].sort());
}

/**
 * It is a transfer: every side gets the transfer category and one shared id, and is reviewed. A withdrawal into a
 * hand-kept asset (Cash) also raises that asset's balance, since nothing else will.
 */
export function confirmTransfer(rows: Row[], transferId: string, handKept?: { id: string; amount: number; add: number }): Decision {
    const events: ReviewEvent[] = rows.map((row) => update({ id: row.id, transaction_category: 'transfer', category_source: 'manual', review: 'reviewed', transfer_id: transferId }));
    const undo: ReviewEvent[] = rows.map((row) => update(previous(row)));
    if (handKept) {
        events.push({ id: id(), type: 'ASSET_UPDATED', timestamp: now(), payload: { id: handKept.id, amount: Math.round((handKept.amount + handKept.add) * 100) / 100 } });
        undo.push({ id: id(), type: 'ASSET_UPDATED', timestamp: now(), payload: { id: handKept.id, amount: handKept.amount } });
    }
    return { events, undo };
}

/** Two separate rows: they stay in review as ordinary rows and are not suggested as a transfer again. */
export function splitTransfer(rows: Row[]): Decision {
    return {
        events: rows.map((row) => update({ id: row.id, transfer_id: NOT_A_TRANSFER })),
        undo: rows.map((row) => update({ id: row.id, transfer_id: row.transfer_id })),
    };
}

/** Accepted as suggested (or as picked): the category and where it came from, and the row is reviewed. */
export function acceptRows(rows: Array<{ row: Row; category: string; source: string }>): Decision {
    return {
        events: rows.map(({ row, category, source }) => update({ id: row.id, transaction_category: category, category_source: source, review: 'reviewed' })),
        undo: rows.map(({ row }) => update(previous(row))),
    };
}

/** Matching results for rows not yet checked: the suggested plan, or `none`. */
export function recordMatches(matches: Array<{ rowId: string; planId: string }>): ReviewEvent[] {
    return matches.map((match) => update({ id: match.rowId, plan_match: match.planId }));
}

export async function run(events: ReviewEvent[]): Promise<void> {
    if (events.length) await executeLocalCommand(events, { submissionId: crypto.randomUUID() });
}
