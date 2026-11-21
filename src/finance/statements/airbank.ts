/**
 * Air Bank monthly statement (PDF "Výpis z běžného účtu"). Written from the
 * October 2026 statement. Columns are taken from the table's own header row,
 * so a small shift in layout does not break it; the bank's totals prove the
 * rows are complete.
 */

import { parseCzDate } from '../bank-parsers/html.js';
import { amountOf, labelValues, totalsChecks } from './common.js';
import { lineText, type Cell, type Line } from './pdf.js';
import type { ParsedStatement, StatementRow } from './types.js';

type Column = 'date' | 'type' | 'name' | 'details' | 'amount' | 'fee';

const DATE = /^\d{1,2}\.\d{1,2}\.\d{4}$/;
const CODE = /^\d{9,}$/;
const ACCOUNT = /^(\d{1,6}-)?\d{2,10}\s*\/\s*\d{4}$|^\d{4,6}\*{4,}\d{4}$/;

export function isAirBankStatement(lines: Line[]): boolean {
    const text = lines.slice(0, 60).map(lineText).join('\n');
    return /Výpis z běžného účtu/.test(text) && /Air Bank a\.s\./.test(lines.map(lineText).join('\n'));
}

export function parseAirBankStatement(lines: Line[]): ParsedStatement {
    const labels = labelValues(lines);
    const account = labels.get('Číslo účtu')?.replace(/\s+/g, '') ?? null;
    const [from, to] = (labels.get('Období výpisu') ?? '').split(/\s+-\s+/);
    const out: ParsedStatement = {
        parser: 'airbank-statement-pdf@1',
        bank: 'Air Bank',
        account,
        iban: labels.get('IBAN')?.replace(/\s+/g, '') ?? null,
        accountName: labels.get('Název účtu') ?? null,
        period: { from: from ? parseCzDate(from) : null, to: to ? parseCzDate(to) : null },
        currency: labels.get('Měna') ?? 'CZK',
        number: labels.get('Číslo výpisu') ?? null,
        opening: amountOf(labels.get('Počáteční zůstatek')),
        closing: amountOf(labels.get('Konečný zůstatek')),
        credited: amountOf(labels.get('Připsáno na účet')),
        debited: amountOf(labels.get('Odepsáno z účtu')),
        overdraftLimit: null,
        rows: [],
        checks: [],
        unplaced: [],
        warnings: [],
    };
    const limit = lines.find((l) => /^Limit kontokorentu/.test(l.cells[0]?.text ?? ''));
    if (limit) out.overdraftLimit = amountOf(limit.cells.at(-1)?.text.replace(/\s*CZK$/, ''));

    // Column starts come from the second header row ("Provedení · Kód transakce · Číslo účtu · Detaily · Částka · Poplatky").
    let starts: Array<{ x: number; column: Column }> | null = null;
    let inTable = false;
    let current: (Partial<StatementRow> & { detailParts: string[]; kindParts: string[] }) | null = null;

    const finish = () => {
        if (!current) return;
        out.rows.push({
            bank: 'Air Bank',
            account: account ?? '',
            bookingDate: current.bookingDate ?? null,
            executionDate: current.executionDate ?? null,
            kind: current.kindParts.join(' '),
            counterpartyName: current.counterpartyName ?? null,
            counterpartyAccount: current.counterpartyAccount ?? null,
            details: current.detailParts.join(' ').trim() || null,
            variableSymbol: null,
            constantSymbol: null,
            specificSymbol: null,
            amount: current.amount ?? 0,
            fee: current.fee ?? 0,
            currency: out.currency,
            reference: current.reference ?? null,
            balanceAfter: 0,
        });
        current = null;
    };

    const columnOf = (cell: Cell): Column => {
        let column: Column = 'date';
        for (const start of starts ?? []) if (cell.x + 6 >= start.x) column = start.column;
        return column;
    };

    for (const line of lines) {
        const first = line.cells[0]?.text ?? '';
        if (first === 'Zaúčtování') { inTable = true; continue; }
        if (first === 'Provedení') {
            const xs = line.cells.map((c) => c.x);
            if (xs.length >= 6) {
                starts = [
                    { x: xs[0], column: 'date' }, { x: xs[1], column: 'type' }, { x: xs[2], column: 'name' },
                    { x: xs[3], column: 'details' }, { x: xs[4], column: 'amount' }, { x: xs[5], column: 'fee' },
                ];
            }
            continue;
        }
        if (!inTable || !starts) continue;
        // Anything starting at the left edge that is not a date ends the table on this page.
        if (columnOf(line.cells[0]) === 'date' && !DATE.test(first)) {
            finish();
            inTable = false;
            continue;
        }

        const byColumn = new Map<Column, string[]>();
        for (const cell of line.cells) {
            const column = columnOf(cell);
            if (!byColumn.has(column)) byColumn.set(column, []);
            byColumn.get(column)!.push(cell.text);
        }
        const get = (c: Column) => byColumn.get(c)?.join(' ');

        // A row begins on the line that carries both a date and an amount.
        if (get('date') && get('amount')) {
            finish();
            current = { detailParts: [], kindParts: [], bookingDate: parseCzDate(get('date')!) };
            current.amount = amountOf(get('amount')) ?? 0;
            current.fee = amountOf(get('fee')) ?? 0;
        } else if (!current) {
            out.unplaced.push(lineText(line));
            continue;
        } else if (get('date')) {
            current.executionDate = parseCzDate(get('date')!);
        }

        const type = get('type');
        if (type) {
            if (CODE.test(type.replace(/\s/g, ''))) current.reference = type.replace(/\s/g, '');
            else current.kindParts.push(type);
        }
        const name = get('name');
        if (name) {
            if (ACCOUNT.test(name)) current.counterpartyAccount = name.replace(/\s+/g, '');
            else if (!current.counterpartyName) current.counterpartyName = name;
            else current.detailParts.push(name);
        }
        const details = get('details');
        if (details) current.detailParts.push(details);
    }
    finish();

    let balance = out.opening ?? 0;
    for (const row of out.rows) {
        const text = row.details ?? '';
        row.variableSymbol = text.match(/\bVS(\d+)/)?.[1] ?? null;
        row.specificSymbol = text.match(/\bSS(\d+)/)?.[1] ?? null;
        row.constantSymbol = text.match(/\bKS(\d+)/)?.[1] ?? null;
        balance = Math.round((balance + row.amount - Math.abs(row.fee)) * 100) / 100;
        row.balanceAfter = balance;
        if (!row.reference) out.warnings.push(`A row of ${row.bookingDate} has no transaction code.`);
    }

    totalsChecks(out, balance);
    return out;
}
