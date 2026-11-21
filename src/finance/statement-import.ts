/**
 * History from a bank statement, read in the browser: the PDF never leaves the device. A statement row becomes the
 * same entity a notification mail would have made when the bank uses one code for both (Air Bank), and otherwise is
 * matched against the mail rows already there by day and amount (ČSOB's statement code is not in its mails), so the
 * overlap between mails and a statement is never counted twice.
 */

import { executeLocalCommand, queryDatabase, type AddTransactionEvent, type Transaction } from '@hearthlog/sdk/data';
import type { Asset } from '../data/assets.js';
import { normalizeAccount } from './account-keys.js';
import { bankRefFor, transactionIdFor } from './bank-ids.js';
import { BANK_LIST, type BankInfo } from './banks.js';
import type { ParsedStatement, StatementCheck, StatementRow } from './statements/types.js';

export type PlannedRowStatus = 'new' | 'exists' | 'matched';

export interface PlannedRow {
    row: StatementRow;
    id: string;
    bankRef: string;
    status: PlannedRowStatus;
}

export interface StatementPlan {
    bank: BankInfo;
    accountKey: string;
    accountDisplay: string;
    asset: Asset | null;
    period: { from: string | null; to: string | null };
    checks: StatementCheck[];
    rows: PlannedRow[];
}

export class StatementImportError extends Error {}

/** Which bank's reference a statement row carries, and whether its mails carry the same one. */
function referenceFor(bank: BankInfo, row: StatementRow): string | null {
    if (!row.reference) return null;
    // Air Bank prints the same transaction code in its statements and its mails; ČSOB's statement code is its own.
    return bank.id === 'airbank' ? bankRefFor(bank.id, row.reference) : bankRefFor(`${bank.id}-statement`, row.reference);
}

/** Reads a statement file and works out, row by row, what importing it would add. */
export async function planStatementImport(bytes: Uint8Array, assets: readonly Asset[]): Promise<StatementPlan> {
    const { analyzeStatement } = await import('./statements/index.js');
    const analysis = await analyzeStatement(bytes);
    if (!analysis.parsed) throw new StatementImportError(analysis.error ?? 'This file is not a statement Finance can read.');
    return planFromParsed(analysis.parsed, assets);
}

/** The pure part of the plan, separate so tests can feed a parsed statement. */
export async function planFromParsed(parsed: ParsedStatement, assets: readonly Asset[], existing?: { ids: Set<string>; rows: Transaction[] }): Promise<StatementPlan> {
    const bank = BANK_LIST.find((candidate) => candidate.name === parsed.bank);
    if (!bank) throw new StatementImportError(`Statements from ${parsed.bank} are not read yet.`);
    const account = normalizeAccount(parsed.iban ?? parsed.account);
    if (!account) throw new StatementImportError('The statement does not name its account.');
    if (account.valid === false) throw new StatementImportError('The account number on the statement did not pass its checksum.');
    const asset = assets.find((candidate) => candidate.link === 'bank' && candidate.account_hash === account.key) ?? null;

    const planned = await Promise.all(parsed.rows.filter((row) => row.bookingDate).map(async (row, index) => {
        const bankRef = referenceFor(bank, row) ?? `${bank.id}-statement:${parsed.period.from ?? ''}:${index}`;
        return { row, bankRef, id: await transactionIdFor(account.key, bankRef) };
    }));

    const known = existing ?? (asset ? await queryDatabase(async (repositories) => {
        const [ids, rows] = await Promise.all([
            repositories.transactions.existingIds(planned.map((entry) => entry.id)),
            repositories.transactions.getAssetRows(asset.id, parsed.period.from ?? '0000-01-01', parsed.period.to ?? '9999-12-31', 5000),
        ]);
        return { ids: new Set(ids), rows };
    }) : { ids: new Set<string>(), rows: [] });

    // Mail rows without the statement's code, by day and amount; each matches one statement row at most.
    const mailRows = new Map<string, number>();
    for (const row of known.rows) {
        if (!row.bank_ref.startsWith('mail:')) continue;
        const key = `${row.due_date.slice(0, 10)}|${Number(row.amount).toFixed(2)}`;
        mailRows.set(key, (mailRows.get(key) ?? 0) + 1);
    }
    const rows: PlannedRow[] = planned.map((entry) => {
        if (known.ids.has(entry.id)) return { ...entry, status: 'exists' as const };
        const key = `${entry.row.bookingDate}|${entry.row.amount.toFixed(2)}`;
        const left = mailRows.get(key) ?? 0;
        if (left > 0) {
            mailRows.set(key, left - 1);
            return { ...entry, status: 'matched' as const };
        }
        return { ...entry, status: 'new' as const };
    });

    return { bank, accountKey: account.key, accountDisplay: account.display, asset, period: parsed.period, checks: parsed.checks, rows };
}

function rowName(row: StatementRow): string {
    return (row.counterpartyName ?? row.details ?? row.kind ?? 'Bank payment').trim() || 'Bank payment';
}

/**
 * Writes the plan's new rows to its account. Rows before this month arrive reviewed, with the category earlier rows
 * of the same name had, so linking does not open an inbox of hundreds; this month's rows wait for review.
 */
export async function applyStatementImport(plan: StatementPlan, today: string): Promise<number> {
    if (!plan.asset) throw new StatementImportError(`Account ${plan.accountDisplay} is not linked yet.`);
    const fresh = plan.rows.filter((entry) => entry.status === 'new');
    const monthStart = `${today.slice(0, 7)}-01`;
    const history = await queryDatabase((repositories) => repositories.transactions.categoryFromHistory(fresh.map((entry) => rowName(entry.row))))
        .catch(() => []);
    const categories = new Map(history.map((entry) => [entry.name, entry.category]));
    for (const entry of fresh) {
        const older = (entry.row.bookingDate ?? today) < monthStart;
        const category = older ? categories.get(rowName(entry.row)) : undefined;
        const counterparty = [entry.row.counterpartyName, entry.row.counterpartyAccount ? normalizeAccount(entry.row.counterpartyAccount)?.display : null].filter(Boolean).join(' · ');
        await executeLocalCommand({
            id: crypto.randomUUID(),
            type: 'TRANSACTION_ADDED',
            timestamp: Date.now(),
            payload: {
                id: entry.id,
                name: rowName(entry.row),
                amount: entry.row.amount,
                due_date: entry.row.bookingDate ?? today,
                transaction_status: 'archived',
                transaction_category: category ?? 'unknown',
                category_source: category ? 'history' : '',
                asset_id: plan.asset.id,
                bank_ref: entry.bankRef,
                bank_text: [entry.row.kind, entry.row.details, entry.row.variableSymbol && `VS ${entry.row.variableSymbol}`].filter(Boolean).join(' · ').slice(0, 500),
                counterparty: counterparty.slice(0, 300),
                review: older ? 'reviewed' : 'new',
            },
        } satisfies AddTransactionEvent);
    }
    return fresh.length;
}
