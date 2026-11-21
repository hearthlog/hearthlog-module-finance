/** Small helpers for reading the table-heavy HTML banks send. */

const NAMED: Record<string, string> = { nbsp: ' ', amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

export function decodeEntities(text: string): string {
    return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (all, code: string) => {
        if (code[0] === '#') {
            const n = code[1].toLowerCase() === 'x' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
            return Number.isFinite(n) ? String.fromCodePoint(n) : all;
        }
        return NAMED[code.toLowerCase()] ?? all;
    });
}

/** Comments hide template rows a bank left empty (ČSOB does this); they must not be read. */
export function stripComments(html: string): string {
    return html.replace(/<!--[\s\S]*?-->/g, '');
}

export function cellText(html: string): string {
    return decodeEntities(html.replace(/<[^>]+>/g, ' ')).replace(/[\s  ]+/g, ' ').trim();
}

/** Visible text, one line per paragraph, row or break. */
export function htmlToText(html: string): string {
    const body = stripComments(html)
        .replace(/<(script|style|head)[\s\S]*?<\/\1>/gi, '')
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<\/(p|tr|div|h\d|li|table)>/gi, '\n')
        .replace(/<[^>]+>/g, ' ');
    return decodeEntities(body)
        .split('\n')
        .map((line) => line.replace(/[\s  ]+/g, ' ').trim())
        .filter(Boolean)
        .join('\n');
}

/** Every innermost table row with exactly two non-empty cells, as label and value. */
export function labelValueRows(html: string): Array<{ label: string; value: string }> {
    const rows: Array<{ label: string; value: string }> = [];
    const clean = stripComments(html);
    for (const row of clean.matchAll(/<tr[^>]*>((?:(?!<tr[\s>])[\s\S])*?)<\/tr>/gi)) {
        const cells = [...row[1].matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)].map((cell) => cellText(cell[1]));
        if (cells.length === 2 && cells[0] && cells[1]) rows.push({ label: cells[0], value: cells[1] });
    }
    return rows;
}

/** Lowercase without diacritics, for matching labels. */
export function normalizeLabel(label: string): string {
    return label.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase().replace(/\s+/g, ' ').trim();
}

/** "+179 681,22 CZK" → 179681.22 and CZK. Czech format: spaces for thousands, comma for decimals. */
export function parseAmount(text: string): { amount: number; currency: string | null } | null {
    const compact = text.replace(/[\s  ]/g, '').replace(/−/g, '-');
    const match = compact.match(/^([+-]?)([\d.,]+)([A-Z]{3})?$/);
    if (!match) return null;
    let number = match[2];
    if (number.includes(',')) number = number.replace(/\./g, '').replace(',', '.');
    const amount = Number(match[1] + number);
    return Number.isFinite(amount) ? { amount, currency: match[3] ?? null } : null;
}

/** "12.11.2026" → "2026-11-12". */
export function parseCzDate(text: string): string | null {
    const match = text.match(/(\d{1,2})\.\s?(\d{1,2})\.\s?(\d{4})/);
    if (!match) return null;
    return `${match[3]}-${match[2].padStart(2, '0')}-${match[1].padStart(2, '0')}`;
}
