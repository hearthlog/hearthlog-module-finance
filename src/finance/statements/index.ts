import { isAirBankStatement, parseAirBankStatement } from './airbank.js';
import { isCsobStatement, parseCsobStatement } from './csob.js';
import { lineText, pdfLines } from './pdf.js';
import type { ParsedStatement } from './types.js';

export interface StatementAnalysis {
    format: 'pdf' | 'unknown';
    bytes: number;
    pages: number;
    parsed: ParsedStatement | null;
    /** Every extracted line with its columns, for building parsers. */
    lines: Array<{ page: number; y: number; text: string; cells: Array<{ x: number; text: string }> }>;
    error: string | null;
}

/** CSV and XML formats join here once a bank's export in them is seen. */
export async function analyzeStatement(bytes: Uint8Array): Promise<StatementAnalysis> {
    const isPdf = new TextDecoder().decode(bytes.slice(0, 5)) === '%PDF-';
    if (!isPdf) return { format: 'unknown', bytes: bytes.length, pages: 0, parsed: null, lines: [], error: 'Only PDF statements are read so far.' };
    // PDF.js takes over the buffer while reading, so the size is noted first.
    const size = bytes.length;
    const { pages, lines } = await pdfLines(bytes);
    const parsed = isAirBankStatement(lines) ? parseAirBankStatement(lines) : isCsobStatement(lines) ? parseCsobStatement(lines) : null;
    return {
        format: 'pdf',
        bytes: size,
        pages,
        parsed,
        lines: lines.map((l) => ({ page: l.page, y: l.y, text: lineText(l), cells: l.cells })),
        error: parsed ? null : 'No statement parser recognised this PDF.',
    };
}
