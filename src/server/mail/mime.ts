/**
 * Just enough MIME to read bank notification emails. Everything works on a
 * binary string (one character per byte) so the signature check sees the
 * exact bytes the bank signed.
 */

export interface HeaderField {
    /** Name as written. */
    name: string;
    /** Everything after the colon, folds kept. */
    rawValue: string;
    /** The whole field as received, without its final CRLF. */
    raw: string;
}

export interface MailPart {
    contentType: string;
    charset: string;
    transferEncoding: string;
    /** Decoded text for text/* parts; empty otherwise. */
    text: string;
    size: number;
}

export interface Mail {
    headers: HeaderField[];
    /** Body as received, CRLF line ends. */
    rawBody: string;
    parts: MailPart[];
}

export function bytesToBinary(bytes: Uint8Array): string {
    let out = '';
    for (let i = 0; i < bytes.length; i += 0x8000) {
        out += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    }
    return out;
}

export function binaryToBytes(text: string): Uint8Array {
    const out = new Uint8Array(text.length);
    for (let i = 0; i < text.length; i++) out[i] = text.charCodeAt(i) & 0xff;
    return out;
}

export function decodeBytes(bytes: Uint8Array, charset = 'utf-8'): string {
    try {
        return new TextDecoder(charset.trim().toLowerCase()).decode(bytes);
    } catch {
        return new TextDecoder('utf-8').decode(bytes);
    }
}

/** Removes header folding (CRLF before whitespace), keeping the whitespace. */
export function unfold(value: string): string {
    return value.replace(/\r\n(?=[ \t])/g, '');
}

function splitHeadersAndBody(raw: string): { head: string; body: string } {
    const at = raw.indexOf('\r\n\r\n');
    if (at === -1) return { head: raw, body: '' };
    return { head: raw.slice(0, at), body: raw.slice(at + 4) };
}

export function parseHeaderBlock(head: string): HeaderField[] {
    const fields: HeaderField[] = [];
    for (const line of head.split('\r\n')) {
        const last = fields.at(-1);
        if (/^[ \t]/.test(line) && last) {
            last.raw += '\r\n' + line;
            last.rawValue += '\r\n' + line;
            continue;
        }
        const colon = line.indexOf(':');
        if (colon <= 0) continue;
        fields.push({ name: line.slice(0, colon), rawValue: line.slice(colon + 1), raw: line });
    }
    return fields;
}

/** The first field of that name, unfolded and trimmed. */
export function headerValue(fields: HeaderField[], name: string): string | undefined {
    const lower = name.toLowerCase();
    const field = fields.find((f) => f.name.toLowerCase() === lower);
    return field ? unfold(field.rawValue).trim() : undefined;
}

export function parseContentType(value = 'text/plain'): { type: string; params: Record<string, string> } {
    const [type, ...rest] = value.split(';');
    const params: Record<string, string> = {};
    for (const piece of rest) {
        const match = piece.match(/^\s*([^=\s]+)\s*=\s*"?([^"]*)"?\s*$/);
        if (match) params[match[1].toLowerCase()] = match[2];
    }
    return { type: (type ?? '').trim().toLowerCase(), params };
}

export function decodeQuotedPrintable(text: string): Uint8Array {
    const clean = text.replace(/=\r\n/g, '');
    const out: number[] = [];
    for (let i = 0; i < clean.length; i++) {
        const hex = clean.slice(i + 1, i + 3);
        if (clean[i] === '=' && /^[0-9A-Fa-f]{2}$/.test(hex)) {
            out.push(parseInt(hex, 16));
            i += 2;
        } else {
            out.push(clean.charCodeAt(i) & 0xff);
        }
    }
    return new Uint8Array(out);
}

export function decodeBase64(text: string): Uint8Array {
    try {
        return binaryToBytes(atob(text.replace(/[^A-Za-z0-9+/=]/g, '')));
    } catch {
        return new Uint8Array();
    }
}

/** A header value for people: raw UTF-8 bytes and RFC 2047 encoded words decoded. */
export function decodeHeaderText(value: string): string {
    const text = decodeBytes(binaryToBytes(value), 'utf-8');
    const word = /=\?([^?]+)\?([BbQq])\?([^?]*)\?=/g;
    const joined = text.replace(/(=\?[^?]+\?[BbQq]\?[^?]*\?=)\s+(?==\?)/g, '$1');
    return joined.replace(word, (_all, charset: string, encoding: string, data: string) => {
        const bytes = encoding.toUpperCase() === 'B' ? decodeBase64(data) : decodeQuotedPrintable(data.replace(/_/g, ' '));
        return decodeBytes(bytes, charset);
    });
}

function collectParts(fields: HeaderField[], body: string, out: MailPart[], depth = 0): void {
    if (depth > 8) return;
    const contentType = parseContentType(headerValue(fields, 'content-type'));
    const transferEncoding = (headerValue(fields, 'content-transfer-encoding') ?? '7bit').toLowerCase();

    if (contentType.type.startsWith('multipart/') && contentType.params.boundary) {
        const segments = body.split('--' + contentType.params.boundary);
        for (const segment of segments.slice(1)) {
            if (segment.startsWith('--')) break;
            const { head, body: partBody } = splitHeadersAndBody(segment.replace(/^\r\n/, ''));
            collectParts(parseHeaderBlock(head), partBody.replace(/\r\n$/, ''), out, depth + 1);
        }
        return;
    }
    if (contentType.type === 'message/rfc822') {
        const { head, body: inner } = splitHeadersAndBody(body);
        collectParts(parseHeaderBlock(head), inner, out, depth + 1);
        return;
    }

    const bytes = transferEncoding === 'quoted-printable'
        ? decodeQuotedPrintable(body)
        : transferEncoding === 'base64' ? decodeBase64(body) : binaryToBytes(body);
    const charset = contentType.params.charset ?? 'utf-8';
    out.push({
        contentType: contentType.type,
        charset,
        transferEncoding,
        text: contentType.type.startsWith('text/') ? decodeBytes(bytes, charset) : '',
        size: bytes.length,
    });
}

export function parseMail(bytes: Uint8Array): Mail {
    // Saved or pasted mail often has bare LF; SMTP and DKIM work on CRLF.
    const raw = bytesToBinary(bytes).replace(/\r?\n/g, '\r\n');
    const { head, body } = splitHeadersAndBody(raw);
    const headers = parseHeaderBlock(head);
    const parts: MailPart[] = [];
    collectParts(headers, body, parts);
    return { headers, rawBody: body, parts };
}
