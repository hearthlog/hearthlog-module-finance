import { parseAmount } from '../bank-parsers/html.js';
import type { Line } from './pdf.js';
import type { ParsedStatement, StatementRow } from './types.js';

/** Header labels end with a colon; the value is the next piece on the line. */
export function labelValues(lines: Line[]): Map<string, string> {
    const out = new Map<string, string>();
    for (const line of lines) {
        line.cells.forEach((cell, i) => {
            const next = line.cells[i + 1];
            if (cell.text.endsWith(':') && next && !next.text.endsWith(':') && !out.has(cell.text)) out.set(cell.text.slice(0, -1), next.text);
        });
    }
    return out;
}

export function amountOf(text: string | undefined): number | null {
    return text ? parseAmount(text)?.amount ?? null : null;
}

export const round2 = (n: number) => Math.round(n * 100) / 100;

const fmt = (n: number | null) => (n === null ? '?' : n.toLocaleString('cs-CZ', { minimumFractionDigits: 2 }));

/** The checks every statement gets: the bank's totals against the rows read. */
/** `references: false` for a bank whose statement prints no transaction code (Česká spořitelna). */
export function totalsChecks(out: ParsedStatement, finalBalance: number, options: { references?: boolean } = {}): void {
    const fees = out.rows.reduce((s, r) => s + Math.abs(r.fee), 0);
    const credits = round2(out.rows.filter((r) => r.amount > 0).reduce((s, r) => s + r.amount, 0));
    const debits = round2(out.rows.filter((r) => r.amount < 0).reduce((s, r) => s - r.amount, 0) + fees);
    out.checks.push(
        { label: 'Credits match the bank’s total', ok: out.credited !== null && Math.abs(credits - out.credited) < 0.005, detail: `rows ${fmt(credits)} · bank ${fmt(out.credited)}` },
        { label: 'Debits match the bank’s total', ok: out.debited !== null && Math.abs(debits - out.debited) < 0.005, detail: `rows ${fmt(debits)} · bank ${fmt(out.debited)}` },
        { label: 'Opening plus rows gives the closing balance', ok: out.closing !== null && Math.abs(finalBalance - out.closing) < 0.005, detail: `computed ${fmt(finalBalance)} · bank ${fmt(out.closing)}` },
        { label: 'No line left unplaced', ok: out.unplaced.length === 0, detail: `${out.unplaced.length} unplaced` },
    );
    if (options.references !== false) {
        out.checks.splice(3, 0, { label: 'Every row has a bank reference', ok: out.rows.every((r: StatementRow) => r.reference), detail: `${out.rows.filter((r) => r.reference).length} of ${out.rows.length}` });
    }
}
