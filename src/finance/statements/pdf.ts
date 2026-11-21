/**
 * Text of a PDF as positioned lines: each line is the text pieces sharing a
 * baseline, left to right, with their x position. Bank statements are tables,
 * so the x position is what tells columns apart.
 */

import { getDocumentProxy } from 'unpdf';

export interface Cell {
    x: number;
    text: string;
}

export interface Line {
    page: number;
    y: number;
    cells: Cell[];
}

export async function pdfLines(bytes: Uint8Array): Promise<{ pages: number; lines: Line[] }> {
    const pdf = await getDocumentProxy(bytes);
    const lines: Line[] = [];
    for (let page = 1; page <= pdf.numPages; page++) {
        const content = await (await pdf.getPage(page)).getTextContent();
        const rows = new Map<number, Cell[]>();
        for (const item of content.items) {
            if (!('str' in item) || !item.str.trim()) continue;
            const y = Math.round(item.transform[5]);
            if (!rows.has(y)) rows.set(y, []);
            rows.get(y)!.push({ x: Math.round(item.transform[4]), text: item.str.trim() });
        }
        for (const y of [...rows.keys()].sort((a, b) => b - a)) {
            lines.push({ page, y, cells: rows.get(y)!.sort((a, b) => a.x - b.x) });
        }
    }
    return { pages: pdf.numPages, lines };
}

export function lineText(line: Line): string {
    return line.cells.map((c) => c.text).join(' ');
}
