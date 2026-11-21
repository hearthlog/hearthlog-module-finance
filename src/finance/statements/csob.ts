/**
 * ČSOB monthly statement (PDF "VÝPIS Z ÚČTU"). Written from the October 2026
 * statement. Each row states the balance after it, so every row is checked
 * against the one before as well as against the bank's totals.
 */

import { parseCzDate } from '../bank-parsers/html.js';
import { amountOf, labelValues, round2, totalsChecks } from './common.js';
import { lineText, type Line } from './pdf.js';
import type { ParsedStatement, StatementRow } from './types.js';

const SHORT_DATE = /^(\d{1,2})\.(\d{1,2})\.$/;
const MONEY = /^-?\d{1,3}( \d{3})*,\d{2}$/;
const ACCOUNT = /^(\d{1,6}-)?\d{2,10}\/\d{4}$/;

export function isCsobStatement(lines: Line[]): boolean {
    const all = lines.map(lineText).join('\n');
    return /VÝPIS Z ÚČTU/.test(all) && /Československá obchodní banka/.test(all);
}

/** "12.10." with the year from the statement period (a December–January period picks the year inside it). */
function fullDate(text: string, from: string | null, to: string | null): string | null {
    const match = text.match(SHORT_DATE);
    if (!match || !from) return null;
    const mmdd = `${match[2].padStart(2, '0')}-${match[1].padStart(2, '0')}`;
    for (const year of new Set([from.slice(0, 4), (to ?? from).slice(0, 4)])) {
        const date = `${year}-${mmdd}`;
        if (date >= from && date <= (to ?? from)) return date;
    }
    return `${from.slice(0, 4)}-${mmdd}`;
}

export function parseCsobStatement(lines: Line[]): ParsedStatement {
    const labels = labelValues(lines);
    const [fromText, toText] = (labels.get('Období') ?? '').split(/\s+-\s+/);
    const from = fromText ? parseCzDate(fromText) : null;
    const to = toText ? parseCzDate(toText) : null;
    const account = labels.get('Účet')?.replace(/\s+/g, '') ?? null;
    const out: ParsedStatement = {
        parser: 'csob-statement-pdf@1',
        bank: 'ČSOB',
        account,
        iban: labels.get('IBAN')?.replace(/\s+/g, '') ?? null,
        accountName: labels.get('Typ účtu') ?? labels.get('Název účtu') ?? null,
        period: { from, to },
        currency: labels.get('Měna') ?? 'CZK',
        number: labels.get('Rok/č. výpisu') ?? null,
        opening: amountOf(labels.get('Počáteční zůstatek')),
        closing: amountOf(labels.get('Konečný zůstatek')),
        credited: amountOf(labels.get('Celkové příjmy')),
        debited: amountOf(labels.get('Celkové výdaje')),
        overdraftLimit: null,
        rows: [],
        checks: [],
        unplaced: [],
        warnings: [],
    };

    // Column starts from the two header rows: "Datum · Označení platby · Název protiúčtu · Identifikace · Částka · Zůstatek"
    // and "Valuta · Protiúčet nebo poznámka · VS · KS · SS". Amounts are right-aligned, so they are told apart by shape.
    let cols: { kind: number; name: number; id: number; vs: number; ks: number; ss: number } | null = null;
    let inTable = false;
    let current: (Partial<StatementRow> & { notes: string[]; stated: number | null }) | null = null;
    const stated: Array<number | null> = [];

    const finish = () => {
        if (!current) return;
        out.rows.push({
            bank: 'ČSOB',
            account: account ?? '',
            bookingDate: current.bookingDate ?? null,
            executionDate: current.executionDate ?? null,
            kind: current.kind ?? '',
            counterpartyName: current.counterpartyName ?? null,
            counterpartyAccount: current.counterpartyAccount ?? null,
            details: current.notes.join(' ') || null,
            variableSymbol: current.variableSymbol ?? null,
            constantSymbol: current.constantSymbol ?? null,
            specificSymbol: current.specificSymbol ?? null,
            amount: current.amount ?? 0,
            fee: 0,
            currency: out.currency,
            reference: current.reference ?? null,
            balanceAfter: current.stated ?? 0,
        });
        stated.push(current.stated);
        current = null;
    };

    for (const line of lines) {
        const texts = line.cells.map((c) => c.text);
        if (texts[0] === 'Datum' && texts.includes('Označení platby')) {
            const at = (label: string) => line.cells.find((c) => c.text === label)?.x ?? 0;
            cols = { kind: at('Označení platby'), name: at('Název protiúčtu'), id: at('Identifikace'), vs: 0, ks: 0, ss: 0 };
            inTable = true;
            continue;
        }
        if (texts[0] === 'Valuta' && cols) {
            const at = (label: string) => line.cells.find((c) => c.text === label)?.x ?? 0;
            cols = { ...cols, vs: at('VS'), ks: at('KS'), ss: at('SS') };
            continue;
        }
        if (!inTable || !cols) continue;
        const firstCell = line.cells[0];
        const leftEdge = firstCell.x < cols.kind - 4;
        if (leftEdge && !SHORT_DATE.test(firstCell.text)) {
            finish();
            inTable = false;
            continue;
        }

        const money = line.cells.filter((c) => c.x > cols!.id + 30 && MONEY.test(c.text));
        if (leftEdge && money.length) {
            finish();
            current = { notes: [], stated: null, bookingDate: fullDate(firstCell.text, from, to) };
            current.amount = amountOf(money[0].text) ?? 0;
            current.stated = money[1] ? amountOf(money[1].text) : null;
        } else if (!current) {
            out.unplaced.push(lineText(line));
            continue;
        } else if (leftEdge) {
            current.executionDate = fullDate(firstCell.text, from, to); // valuta
        }

        for (const cell of line.cells) {
            if (money.includes(cell) || (leftEdge && cell === firstCell)) continue;
            const isFirstLine = current.kind === undefined;
            if (cell.x < cols.name - 4) {
                if (isFirstLine) current.kind = cell.text;
                else if (ACCOUNT.test(cell.text.replace(/\s+/g, ''))) current.counterpartyAccount = cell.text.replace(/\s+/g, '');
                else current.notes.push(cell.text);
            } else if (cell.x >= cols.id - 4 && cell.x <= cols.id + 30 && /^\d+$/.test(cell.text)) {
                current.reference = cell.text;
            } else if (money.length) {
                // The first line: everything between kind and identification is the counterparty's name.
                current.counterpartyName = current.counterpartyName ? `${current.counterpartyName} ${cell.text}` : cell.text;
            } else {
                // Later lines: the nearest symbol column.
                const nearest = [['vs', cols.vs], ['ks', cols.ks], ['ss', cols.ss]].sort((a, b) => Math.abs(cell.x - (b[1] as number)) - Math.abs(cell.x - (a[1] as number))).at(-1)![0];
                if (nearest === 'vs') current.variableSymbol = cell.text;
                else if (nearest === 'ks') current.constantSymbol = cell.text;
                else current.specificSymbol = cell.text;
            }
        }
        if (current.kind === undefined) current.kind = '';
    }
    finish();

    let balance = out.opening ?? 0;
    let chainOk = true;
    out.rows.forEach((row, i) => {
        balance = round2(balance + row.amount);
        if (stated[i] === null) row.balanceAfter = balance;
        else if (Math.abs((stated[i] as number) - balance) >= 0.005) {
            chainOk = false;
            out.warnings.push(`Row of ${row.bookingDate} (${row.reference ?? '?'}): the bank states ${stated[i]}, the rows give ${balance}.`);
            balance = stated[i] as number;
        }
    });

    totalsChecks(out, balance);
    const credits = Number(labels.get('Počet kreditních položek') ?? NaN);
    const debits = Number(labels.get('Počet debetních položek') ?? NaN);
    out.checks.push(
        { label: 'Each row’s stated balance follows from the one before', ok: chainOk, detail: chainOk ? `${out.rows.length} rows` : 'see warnings' },
        {
            label: 'Row counts match the bank’s counts',
            ok: out.rows.filter((r) => r.amount > 0).length === credits && out.rows.filter((r) => r.amount < 0).length === debits,
            detail: `credits ${out.rows.filter((r) => r.amount > 0).length}/${credits} · debits ${out.rows.filter((r) => r.amount < 0).length}/${debits}`,
        },
    );
    return out;
}
