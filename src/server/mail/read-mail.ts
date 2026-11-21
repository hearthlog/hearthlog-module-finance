/**
 * What one forwarded mail is: a bank notification Finance can read, the mailbox's forwarding confirmation (whose code
 * the linking step shows), or something set aside for the user to look at. A bank's parser runs only on mail its bank
 * signed: the DKIM signature must pass for the bank's domain and match the From address, so a forwarded copy of
 * someone else's notification, or a look-alike, never becomes a row.
 */

import { verifyDkim, type DkimSummary, type KeyLookup } from './dkim.js';
import { decodeHeaderText, headerValue, parseMail, type Mail } from './mime.js';
import { htmlToText, labelValueRows } from '../../finance/bank-parsers/html.js';
import { PARSERS } from '../../finance/bank-parsers/index.js';
import type { BankParser, ParsedEmail, ParserInput } from '../../finance/bank-parsers/types.js';

/** The text kept of a mail set aside: enough to read it, never the raw message or its attachments. */
export const MAX_KEPT_TEXT = 20_000;

interface MailBase {
    messageId: string | null;
    subject: string;
    from: string;
    /** The Date header, as ISO, when it parses. */
    sentAt: string | null;
    text: string;
}

export type MailReading = MailBase & (
    | { kind: 'payment'; parser: string; bank: string; parsed: ParsedEmail }
    /** `verified` is false when the forwarding service's signature could not be checked; the code is shown either way. */
    | { kind: 'confirmation'; code: string; verified: boolean; reason: string }
    | { kind: 'unread'; bank: string | null; reason: string }
);

export interface ReadOptions {
    now?: number;
    /** DKIM key lookup; DNS over HTTPS by default. */
    lookup?: KeyLookup;
    /** Tests replace the signature check; production never passes this. */
    verify?: (mail: ReturnType<typeof parseMail>, now: number) => Promise<DkimSummary>;
}

const GMAIL_FORWARDING = 'forwarding-noreply@google.com';

function domainMatches(domain: string, parser: BankParser): boolean {
    const d = domain.toLowerCase();
    return parser.domains.some((candidate) => d === candidate || d.endsWith(`.${candidate}`));
}

/**
 * Why a signature was not trusted, in a line that fits the mail's record: each signature with its domain and the
 * check that failed, and what the receiving server (Cloudflare) concluded, when the mail carries its verdict.
 * Kept so a failure can be told apart from a forged mail without keeping the raw message.
 */
export function describeSignatures(dkim: DkimSummary, mail: Mail): string {
    const own = dkim.checks.length
        ? dkim.checks.map((check) => `${check.domain || '?'} (s=${check.selector || '?'}, ${check.algorithm || '?'}, ${check.canonicalization}): ${check.status}${check.reason ? `, ${check.reason}` : ''}${check.alignedWithFrom ? '' : ', not the From domain'}`).join('; ')
        : `no signature (From domain ${dkim.fromDomain || '?'})`;
    const verdicts = mail.headers
        .filter((field) => /^(arc-)?authentication-results$/i.test(field.name))
        .slice(0, 2)
        .map((field) => {
            const value = field.rawValue.replace(/\s+/g, ' ').trim();
            const server = value.replace(/^i=\d+;\s*/, '').split(';')[0]?.trim() ?? '?';
            const results = [...value.matchAll(/\b(dkim|spf|dmarc|arc)=([a-z]+)(?:[^;]*?header\.(?:d|from)=([^\s;]+))?/gi)]
                .map((match) => `${match[1]!.toLowerCase()}=${match[2]!.toLowerCase()}${match[3] ? ` ${match[3]}` : ''}`);
            return `${field.name} by ${server}: ${results.join(', ') || 'no results'}`;
        });
    return [`Own check: ${own}`, verdicts.length ? `Received with ${verdicts.join(' | ')}` : 'No Authentication-Results header'].join('. ').slice(0, 900);
}

function addressOf(from: string): string {
    return (from.match(/<([^>]+)>/)?.[1] ?? from).trim().toLowerCase();
}

export async function readMail(bytes: Uint8Array, options: ReadOptions = {}): Promise<MailReading> {
    const now = options.now ?? Date.now();
    const mail = parseMail(bytes);
    const header = (name: string) => headerValue(mail.headers, name);
    const subject = decodeHeaderText(header('subject') ?? '');
    const from = decodeHeaderText(header('from') ?? '');
    const sent = header('date') ? new Date(header('date')!) : null;
    const html = mail.parts.find((part) => part.contentType === 'text/html')?.text ?? '';
    const plain = mail.parts.find((part) => part.contentType === 'text/plain')?.text ?? '';
    const text = (html ? htmlToText(html) : plain).slice(0, MAX_KEPT_TEXT);
    const base: MailBase = {
        messageId: header('message-id')?.trim() ?? null,
        subject,
        from,
        sentAt: sent && !Number.isNaN(sent.getTime()) ? sent.toISOString() : null,
        text,
    };

    const dkim = await (options.verify ? options.verify(mail, now) : verifyDkim(mail, now, options.lookup));
    const signed = dkim.best?.status === 'pass' && dkim.best.alignedWithFrom ? dkim.best.domain.toLowerCase() : null;
    const claimed = PARSERS.find((parser) => domainMatches(dkim.fromDomain, parser)) ?? null;

    if (addressOf(from) === GMAIL_FORWARDING) {
        const code = `${subject}\n${text}`.match(/\(#(\d{6,12})\)|(?:confirmation code|kód pro potvrzení)[^\d]{0,20}(\d{6,12})/i);
        const verified = signed === 'google.com' || !!signed?.endsWith('.google.com');
        // The code is only ever pasted back into the mailbox, which checks it itself, so an unverified one is shown too.
        if (code) return { ...base, kind: 'confirmation', code: (code[1] ?? code[2])!, verified, reason: verified ? 'Forwarding confirmation' : `Forwarding confirmation, signature not verified. ${describeSignatures(dkim, mail)}` };
        return { ...base, kind: 'unread', bank: null, reason: `A forwarding message without a code. ${describeSignatures(dkim, mail)}` };
    }

    if (!signed) {
        return {
            ...base,
            kind: 'unread',
            bank: claimed?.bank ?? null,
            reason: claimed ? `Not signed by ${claimed.bank}, so it was not trusted. ${describeSignatures(dkim, mail)}` : `Not from a bank Finance reads. ${describeSignatures(dkim, mail)}`,
        };
    }
    const input: ParserInput = { subject, from, domain: signed, html, text: html ? htmlToText(html) : plain, rows: html ? labelValueRows(html) : [] };
    const parser = PARSERS.find((candidate) => domainMatches(signed, candidate) && candidate.matches(input));
    if (!parser) {
        const bank = PARSERS.find((candidate) => domainMatches(signed, candidate))?.bank ?? null;
        return { ...base, kind: 'unread', bank, reason: bank ? `A ${bank} message Finance does not know yet` : 'Not from a bank Finance reads' };
    }
    const parsed = parser.parse(input);
    if (parsed.amount === null || !parsed.account || !parsed.bookingDate) {
        return { ...base, kind: 'unread', bank: parser.bank, reason: `The ${parser.bank} message was missing ${[parsed.amount === null && 'the amount', !parsed.account && 'the account', !parsed.bookingDate && 'the date'].filter(Boolean).join(', ')}` };
    }
    return { ...base, kind: 'payment', parser: `${parser.id}@${parser.version}`, bank: parser.bank, parsed };
}
