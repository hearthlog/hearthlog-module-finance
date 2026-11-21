/**
 * Which plan a bank row probably paid, and which bank rows only move money between the user's own accounts. Pure:
 * every device computes the same suggestions from the same rows, and nothing here writes. Nothing is ever linked
 * without the user: a match pauses the plan ("looks paid") until Confirm or Not this one.
 */

import { differenceInCalendarDays, parseISO } from 'date-fns';
import { accountKey } from './account-keys.js';

/** `plan_match` once a row was checked and no plan fits, or the user said Not this one: it is never suggested again. */
export const NO_MATCH = 'none';
/** `transfer_id` once the user said the two rows are separate. */
export const NOT_A_TRANSFER = 'none';

export interface MatchRow {
    id: string;
    amount: number;
    /** `YYYY-MM-DD`. */
    date: string;
    name: string;
    bankText: string;
    assetId: string;
    counterparty: string;
}

export interface MatchPlan {
    id: string;
    amount: number;
    date: string;
    name: string;
    category: string;
    /** Set when the plan names its account; it then only matches rows of that account. */
    assetId: string;
}

export interface PlanMatch {
    rowId: string;
    planId: string;
    score: number;
    /** "Same amount · 3 days early · you confirmed this pair before". */
    why: string;
}

const round2 = (n: number) => Math.round(n * 100) / 100;
const MAX_DAYS = 5;
const THRESHOLD = 40;

/** How far an amount may be off: 2 % of the plan, at least 50 Kč. */
export function amountTolerance(plan: number): number {
    return Math.max(50, Math.abs(plan) * 0.02);
}

function daysWord(days: number): string {
    if (days === 0) return 'same day';
    const n = Math.abs(days);
    return `${n} ${n === 1 ? 'day' : 'days'} ${days < 0 ? 'early' : 'late'}`;
}

/**
 * How well a bank row fits a plan, or null when it cannot be the plan: another sign, an amount off by more than the
 * tolerance, more than five days apart, or a plan tied to another account. `confirmedBefore` is true when an earlier
 * bank row with the same bank text was confirmed as a plan of this name.
 */
export function scorePlan(row: MatchRow, plan: MatchPlan, confirmedBefore: boolean): PlanMatch | null {
    if (Math.sign(row.amount) !== Math.sign(plan.amount) || row.amount === 0) return null;
    if (plan.assetId && plan.assetId !== row.assetId) return null;
    const diff = round2(Math.abs(row.amount - plan.amount));
    const tolerance = amountTolerance(plan.amount);
    if (diff > tolerance) return null;
    const days = differenceInCalendarDays(parseISO(row.date), parseISO(plan.date));
    if (Math.abs(days) > MAX_DAYS) return null;
    const score = 100 - (diff / tolerance) * 40 - Math.abs(days) * 6 + (confirmedBefore ? 30 : 0) + (plan.assetId ? 10 : 0);
    if (score < THRESHOLD) return null;
    const amountPart = diff === 0 ? 'Same amount' : `${diff.toLocaleString('cs-CZ')} Kč apart`;
    const why = [amountPart, daysWord(days), confirmedBefore ? 'you confirmed this pair before' : ''].filter(Boolean).join(' · ');
    return { rowId: row.id, planId: plan.id, score: round2(score), why };
}

/**
 * The best plan for each row, each plan used once: the highest-scoring pairs win first. Rows with no plan above the
 * threshold are listed with `planId: NO_MATCH`, so they are not checked again.
 */
export function matchPlans(rows: readonly MatchRow[], plans: readonly MatchPlan[], confirmedNames: (bankText: string) => ReadonlySet<string>): PlanMatch[] {
    const candidates: PlanMatch[] = [];
    for (const row of rows) {
        const names = confirmedNames(row.bankText);
        for (const plan of plans) {
            const match = scorePlan(row, plan, !!row.bankText && names.has(plan.name.trim().toLowerCase()));
            if (match) candidates.push(match);
        }
    }
    candidates.sort((a, b) => b.score - a.score || a.rowId.localeCompare(b.rowId) || a.planId.localeCompare(b.planId));
    const usedRows = new Set<string>();
    const usedPlans = new Set<string>();
    const result: PlanMatch[] = [];
    for (const candidate of candidates) {
        if (usedRows.has(candidate.rowId) || usedPlans.has(candidate.planId)) continue;
        usedRows.add(candidate.rowId);
        usedPlans.add(candidate.planId);
        result.push(candidate);
    }
    for (const row of rows) if (!usedRows.has(row.id)) result.push({ rowId: row.id, planId: NO_MATCH, score: 0, why: '' });
    return result;
}

export interface TransferAccount {
    id: string;
    name: string;
    /** The normalised account number of a linked account; empty for hand-kept assets. */
    accountKey: string;
}

export type TransferSuggestion =
    /** Both sides arrived: a debit on one account and the same credit on another. */
    | { kind: 'pair'; from: MatchRow; to: MatchRow; amount: number; why: string }
    /** One side arrived and names another of the user's accounts as its counterparty. */
    | { kind: 'own'; from: MatchRow; toAssetId: string; amount: number; why: string }
    /** A cash withdrawal: it lands in the hand-kept Cash asset. */
    | { kind: 'cash'; from: MatchRow; toAssetId: string; amount: number; why: string };

const CASH_WITHDRAWAL = /výběr|vyber|bankomat|\batm\b|withdrawal|hotovost/i;
const CASH_ASSET = /^(cash|hotovost|peněženka|penezenka)\b/i;

/** The counterparty's account as the row records it ("Name · 123/0300"), normalised; empty when there is none. */
export function counterpartyKey(counterparty: string): string {
    for (const part of counterparty.split('·').map((piece) => piece.trim()).reverse()) {
        const key = accountKey(part);
        if (key && !key.startsWith('TEXT:')) return key;
    }
    return '';
}

/**
 * Rows that look like moves between the user's own accounts, most certain first: equal opposite amounts on two
 * accounts within two days, then a counterparty that is one of the user's accounts, then cash withdrawals when a
 * hand-kept Cash asset exists. Each row is suggested once.
 */
export function suggestTransfers(rows: readonly MatchRow[], accounts: readonly TransferAccount[]): TransferSuggestion[] {
    const used = new Set<string>();
    const out: TransferSuggestion[] = [];
    const byKey = new Map(accounts.filter((account) => account.accountKey).map((account) => [account.accountKey, account]));
    const name = (id: string) => accounts.find((account) => account.id === id)?.name ?? 'another account';

    const debits = rows.filter((row) => row.amount < 0 && row.assetId);
    const credits = rows.filter((row) => row.amount > 0 && row.assetId);
    const pairs: Array<{ from: MatchRow; to: MatchRow; days: number; named: boolean }> = [];
    for (const from of debits) {
        for (const to of credits) {
            if (to.assetId === from.assetId || Math.abs(from.amount + to.amount) >= 0.005) continue;
            const days = Math.abs(differenceInCalendarDays(parseISO(to.date), parseISO(from.date)));
            if (days > 2) continue;
            const target = byKey.get(counterpartyKey(from.counterparty));
            pairs.push({ from, to, days, named: target?.id === to.assetId });
        }
    }
    pairs.sort((a, b) => Number(b.named) - Number(a.named) || a.days - b.days || a.from.id.localeCompare(b.from.id));
    for (const pair of pairs) {
        if (used.has(pair.from.id) || used.has(pair.to.id)) continue;
        used.add(pair.from.id);
        used.add(pair.to.id);
        const when = pair.days === 0 ? 'on the same day' : `${pair.days} ${pair.days === 1 ? 'day' : 'days'} apart`;
        out.push({
            kind: 'pair', from: pair.from, to: pair.to, amount: -pair.from.amount,
            why: `Equal amounts ${when}${pair.named ? ` · the counterparty is your ${name(pair.to.assetId)}` : ''}`,
        });
    }

    for (const row of rows) {
        if (used.has(row.id) || !row.assetId) continue;
        const target = byKey.get(counterpartyKey(row.counterparty));
        if (!target || target.id === row.assetId) continue;
        used.add(row.id);
        out.push({
            kind: 'own', from: row, toAssetId: target.id, amount: Math.abs(row.amount),
            why: `The counterparty is your ${target.name} · its side has not arrived yet`,
        });
    }

    const cash = accounts.find((account) => !account.accountKey && CASH_ASSET.test(account.name.trim()));
    if (cash) {
        for (const row of rows) {
            if (used.has(row.id) || row.amount >= 0 || !CASH_WITHDRAWAL.test(`${row.name} ${row.bankText}`)) continue;
            used.add(row.id);
            out.push({ kind: 'cash', from: row, toAssetId: cash.id, amount: -row.amount, why: `Cash withdrawals usually land in ${cash.name} · this also raises its balance` });
        }
    }
    return out;
}
