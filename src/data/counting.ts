import { sql, type RawBuilder } from 'kysely';
import type { ReadModelSession } from '@hearthlog/sdk/data';
import { TRANSFER_CATEGORY } from '../finance/categories.js';

/**
 * What moves a balance and what counts as income or spending, in one place so every query agrees.
 *
 * - A transfer (category `transfer`) only moves money between the user's own accounts: it never changes the sum of
 *   assets, so it is left out of the forecast and out of income and expense totals.
 * - A paused plan is an active plan that a bank row names as its likely match (`plan_match`). It "looks paid": the
 *   bank row already counts as done, so the plan leaves the forecast and the planned totals until the user confirms
 *   or declines the match.
 *
 * `alias` is the name the query gives the transactions table.
 */

export function isTransfer(alias: string): RawBuilder<boolean> {
    return sql<boolean>`COALESCE(${sql.ref(`${alias}.transaction_category`)}, '') = ${TRANSFER_CATEGORY}`;
}

export function isPaused(session: ReadModelSession, alias: string): RawBuilder<boolean> {
    return sql<boolean>`(${sql.ref(`${alias}.transaction_status`)} = 'active' AND EXISTS (
        SELECT 1 FROM ${session.table('transactions')} AS bank_matches
        WHERE bank_matches.plan_match = ${sql.ref(`${alias}.id`)} AND bank_matches.id <> ${sql.ref(`${alias}.id`)}
    ))`;
}

/** An active row that moves the forecast: not a transfer and not paused. The caller adds its own date window. */
export function countsInForecast(session: ReadModelSession, alias: string): RawBuilder<boolean> {
    return sql<boolean>`(${sql.ref(`${alias}.transaction_status`)} = 'active' AND NOT ${isTransfer(alias)} AND NOT ${isPaused(session, alias)})`;
}
