/**
 * Česká spořitelna monthly statement (PDF "Výpis z účtu", from George). Written from the October 2026 statement of a
 * Standard account. Each row starts on the line with its booking date and item; under it come the execution date,
 * the constant and specific symbols and the description. The columns are taken from the table's header row, and the
 * bank's totals prove the rows are complete. The statement prints no transaction code.
 */

import { parseCzDate } from '../bank-parsers/html.js';
import { amountOf, labelValues, totalsChecks } from './common.js';
import { lineText, type Cell, type Line } from './pdf.js';
import type { ParsedStatement, StatementRow } from './types.js';

type Column = 'date' | 'item' | 'counterparty' | 'symbol' | 'amount';

const DATE = /^\d{1,2}\.\d{1,2}\.\d{4}$/;
const ACCOUNT = /^(\d{1,6}-)?\d{2,10}\s*\/\s*\d{4}$/;
const BANK = 'Česká spořitelna';

export function isCsasStatement(lines: Line[]): boolean {
    const text = lines.map(lineText).join('\n');
    return /^Výpis z účtu$/m.test(lines.slice(0, 10).map(lineText).join('\n')) && /Česká spořitelna, a\.s\./.test(text) && /PŘEHLED POHYBŮ NA ÚČTU/.test(text);
}

export function parseCsasStatement(lines: Line[]): ParsedStatement {
    const labels = labelValues(lines);
    const text = lines.map(lineText).join('\n');
    const account = text.match(/Číslo účtu\/kód banky:\s*(\S+)/)?.[1] ?? null;
    const period = text.match(/Období:\s*(\d{1,2}\.\d{1,2}\.\d{4})\s*-\s*(\d{1,2}\.\d{1,2}\.\d{4})/);
    const debited = amountOf(labels.get('Celkem odešlo'));
    const out: ParsedStatement = {
        parser: 'csas-statement-pdf@1',
        bank: BANK,
        account,
        iban: text.match(/Číslo účtu \(IBAN\):\s*([A-Z]{2}[\d ]{14,40}\d)/)?.[1]?.replace(/\s+/g, '') ?? null,
        accountName: lines[1]?.cells[0]?.text ?? null,
        period: { from: period ? parseCzDate(period[1]) : null, to: period ? parseCzDate(period[2]) : null },
        currency: text.match(/Měna účtu:\s*([A-Z]{3})/)?.[1] ?? 'CZK',
        number: text.match(/Číslo výpisu:\s*(\S+)/)?.[1] ?? null,
        opening: amountOf(labels.get('Počáteční zůstatek')),
        closing: amountOf(labels.get('Konečný zůstatek')),
        credited: amountOf(labels.get('Celkem přišlo')),
        debited: debited === null ? null : Math.abs(debited),
        overdraftLimit: null,
        rows: [],
        checks: [],
        unplaced: [],
        warnings: [],
    };

    let starts: Array<{ x: number; column: Column }> | null = null;
    let inTable = false;
    let current: (Partial<StatementRow> & { detailParts: string[]; symbols: string[]; hasAmount: boolean }) | null = null;

    const finish = () => {
        if (!current) return;
        if (!current.hasAmount) out.warnings.push(`A row of ${current.bookingDate} (${current.kind}) has no amount.`);
        out.rows.push({
            bank: BANK,
            account: account ?? '',
            bookingDate: current.bookingDate ?? null,
            executionDate: current.executionDate ?? null,
            kind: current.kind ?? '',
            counterpartyName: current.counterpartyName ?? null,
            counterpartyAccount: current.counterpartyAccount ?? null,
            details: current.detailParts.join(' ').trim() || null,
            variableSymbol: current.variableSymbol ?? null,
            constantSymbol: current.symbols[0] ?? null,
            specificSymbol: current.symbols[1] ?? null,
            amount: current.amount ?? 0,
            fee: 0,
            currency: out.currency,
            reference: null,
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
        // "Zaúčtováno · Položka · Číslo protiúčtu · Variabilní symbol · Částka" opens the table on each page.
        if (first === 'Zaúčtováno' && line.cells.length >= 5) {
            const xs = line.cells.map((c) => c.x);
            // Amounts are right-aligned under "Částka": the column starts well left of its header.
            starts = [
                { x: xs[0], column: 'date' }, { x: xs[1], column: 'item' }, { x: xs[2], column: 'counterparty' },
                { x: xs[3], column: 'symbol' }, { x: xs[3] + (xs[4] - xs[3]) * 0.55, column: 'amount' },
            ];
            inTable = true;
            continue;
        }
        if (!inTable || !starts) continue;
        if (['Provedeno', 'Částka obratu cizí měny', 'Popis'].includes(first)) continue;
        // The closing balance ends the table; a footer or a new section ends it on this page.
        if (line.cells.some((c) => c.text === 'Konečný zůstatek:') || line.y < 60 || /^[A-ZÁČĎÉĚÍŇÓŘŠŤÚŮÝŽ ]{8,}$/.test(first)) {
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
        const date = get('date');

        if (date && DATE.test(date) && get('item')) {
            finish();
            current = { detailParts: [], symbols: [], hasAmount: false, bookingDate: parseCzDate(date), kind: get('item') };
            const counterparty = get('counterparty');
            if (counterparty) {
                if (ACCOUNT.test(counterparty)) current.counterpartyAccount = counterparty.replace(/\s+/g, '');
                else current.counterpartyName = counterparty;
            }
            if (get('symbol')) current.variableSymbol = get('symbol');
            if (get('amount')) {
                current.amount = amountOf(get('amount')) ?? 0;
                current.hasAmount = true;
            }
            continue;
        }
        if (!current) {
            out.unplaced.push(lineText(line));
            continue;
        }
        if (date && DATE.test(date)) current.executionDate = parseCzDate(date);
        else if (date) current.detailParts.push(date);

        const item = get('item');
        // A bare date in the description repeats the execution or due date.
        if (item && !DATE.test(item)) current.detailParts.push(item);
        const counterparty = get('counterparty');
        if (counterparty) {
            if (ACCOUNT.test(counterparty) && !current.counterpartyAccount) current.counterpartyAccount = counterparty.replace(/\s+/g, '');
            else if (!current.counterpartyName && !counterparty.includes(':')) current.counterpartyName = counterparty;
            else current.detailParts.push(counterparty);
        }
        const symbol = get('symbol');
        if (symbol) current.symbols.push(symbol);
        const amount = get('amount');
        if (amount) {
            if (current.hasAmount) out.unplaced.push(lineText(line));
            else {
                current.amount = amountOf(amount) ?? 0;
                current.hasAmount = true;
            }
        }
    }
    finish();

    let balance = out.opening ?? 0;
    for (const row of out.rows) {
        balance = Math.round((balance + row.amount) * 100) / 100;
        row.balanceAfter = balance;
    }
    totalsChecks(out, balance, { references: false });
    return out;
}
