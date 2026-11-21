/**
 * DKIM verification (RFC 6376) for rsa-sha256 and rsa-sha1, both
 * canonicalizations. The public key comes from DNS over HTTPS, so it runs the
 * same in a Worker and in tests.
 */

import { binaryToBytes, headerValue, unfold, type HeaderField, type Mail } from './mime.js';
import { derLength, RSA_ALGORITHM } from './der.js';

export interface DkimCheck {
    status: 'pass' | 'fail' | 'error';
    domain: string;
    selector: string;
    algorithm: string;
    canonicalization: string;
    signedHeaders: string[];
    bodyHash: 'match' | 'mismatch' | 'unchecked';
    alignedWithFrom: boolean;
    expired: boolean;
    reason: string;
}

export interface DkimSummary {
    status: 'pass' | 'fail' | 'none' | 'error';
    fromDomain: string;
    checks: DkimCheck[];
    /** The check that decides: an aligned pass first, then any pass, then the first. */
    best: DkimCheck | null;
}

const DNS_OVER_HTTPS = 'https://cloudflare-dns.com/dns-query';

export function fromDomainOf(from: string | undefined): string {
    const address = from?.match(/<([^>]+)>/)?.[1] ?? from ?? '';
    return (address.split('@')[1] ?? '').trim().toLowerCase().replace(/>$/, '');
}

function parseTags(value: string): Record<string, string> {
    const tags: Record<string, string> = {};
    for (const piece of unfold(value).split(';')) {
        const at = piece.indexOf('=');
        if (at === -1) continue;
        const key = piece.slice(0, at).trim().toLowerCase();
        const raw = piece.slice(at + 1);
        tags[key] = ['b', 'bh', 'p'].includes(key) ? raw.replace(/\s+/g, '') : raw.trim();
    }
    return tags;
}

function canonBody(body: string, mode: string): string {
    let lines = body.split('\r\n');
    if (mode === 'relaxed') lines = lines.map((line) => line.replace(/[ \t]+/g, ' ').replace(/ $/, ''));
    while (lines.length && lines.at(-1) === '') lines.pop();
    if (lines.length === 0) return mode === 'simple' ? '\r\n' : '';
    return lines.join('\r\n') + '\r\n';
}

function canonHeader(field: HeaderField, mode: string): string {
    if (mode === 'simple') return field.raw;
    const value = unfold(field.rawValue).replace(/[ \t]+/g, ' ').trim();
    return field.name.trim().toLowerCase() + ':' + value;
}

function toBase64(bytes: ArrayBuffer): string {
    let text = '';
    for (const byte of new Uint8Array(bytes)) text += String.fromCharCode(byte);
    return btoa(text);
}

/** A bare PKCS#1 RSAPublicKey wrapped as SubjectPublicKeyInfo, for the few domains that publish one. */
function wrapPkcs1(pkcs1: Uint8Array): Uint8Array {
    const bitString = [0x03, ...derLength(pkcs1.length + 1), 0x00, ...pkcs1];
    const body = [...RSA_ALGORITHM, ...bitString];
    return new Uint8Array([0x30, ...derLength(body.length), ...body]);
}

const keyCache = new Map<string, Promise<Record<string, string>>>();

async function lookupKeyRecord(selector: string, domain: string): Promise<Record<string, string>> {
    const name = `${selector}._domainkey.${domain}`;
    let pending = keyCache.get(name);
    if (!pending) {
        pending = (async () => {
            const response = await fetch(`${DNS_OVER_HTTPS}?name=${encodeURIComponent(name)}&type=TXT`, {
                headers: { accept: 'application/dns-json' },
            });
            if (!response.ok) throw new Error(`DNS lookup of ${name} answered ${response.status}`);
            const json = (await response.json()) as { Answer?: Array<{ type: number; data: string }> };
            const record = (json.Answer ?? [])
                .filter((answer) => answer.type === 16)
                .map((answer) => {
                    const strings = answer.data.match(/"((?:[^"\\]|\\.)*)"/g);
                    return strings ? strings.map((s) => s.slice(1, -1)).join('') : answer.data;
                })
                .find((text) => /p=/.test(text));
            if (!record) throw new Error(`No DKIM key published at ${name}`);
            return parseTags(record);
        })();
        keyCache.set(name, pending);
        pending.catch(() => keyCache.delete(name));
    }
    return pending;
}

async function importKey(p: string, hash: 'SHA-256' | 'SHA-1'): Promise<CryptoKey> {
    const der = binaryToBytes(atob(p));
    const algorithm = { name: 'RSASSA-PKCS1-v1_5', hash };
    try {
        return await crypto.subtle.importKey('spki', der, algorithm, false, ['verify']);
    } catch {
        return crypto.subtle.importKey('spki', wrapPkcs1(der), algorithm, false, ['verify']);
    }
}

/** Finds a DKIM key record (`selector._domainkey.domain`); tests pass their own. */
export type KeyLookup = (selector: string, domain: string) => Promise<Record<string, string>>;

async function verifyOne(mail: Mail, signature: HeaderField, fromDomain: string, now: number, lookup: KeyLookup): Promise<DkimCheck> {
    const tags = parseTags(signature.rawValue);
    const domain = (tags.d ?? '').toLowerCase();
    const check: DkimCheck = {
        status: 'error',
        domain,
        selector: tags.s ?? '',
        algorithm: tags.a ?? '',
        canonicalization: tags.c ?? 'simple/simple',
        signedHeaders: (tags.h ?? '').split(':').map((h) => h.trim()).filter(Boolean),
        bodyHash: 'unchecked',
        alignedWithFrom: !!domain && (fromDomain === domain || fromDomain.endsWith('.' + domain)),
        expired: !!tags.x && Number(tags.x) * 1000 < now,
        reason: '',
    };
    try {
        if (!domain || !tags.s || !tags.b || !tags.bh || !tags.h) throw new Error('Signature is missing a required tag');
        const hash = check.algorithm === 'rsa-sha256' ? 'SHA-256' : check.algorithm === 'rsa-sha1' ? 'SHA-1' : null;
        if (!hash) throw new Error(`Algorithm ${check.algorithm} is not handled in this proof of concept`);
        const [headerMode, bodyMode = 'simple'] = check.canonicalization.toLowerCase().split('/');

        let body = canonBody(mail.rawBody, bodyMode);
        if (tags.l) body = body.slice(0, Number(tags.l));
        const bodyHash = toBase64(await crypto.subtle.digest(hash, binaryToBytes(body)));
        check.bodyHash = bodyHash === tags.bh ? 'match' : 'mismatch';
        if (check.bodyHash === 'mismatch') {
            check.status = 'fail';
            check.reason = 'The body changed after the bank signed it';
            return check;
        }

        const used = new Map<string, number>();
        let data = '';
        for (const name of check.signedHeaders) {
            const lower = name.toLowerCase();
            const instances = mail.headers.filter((f) => f.name.toLowerCase() === lower);
            const taken = used.get(lower) ?? 0;
            used.set(lower, taken + 1);
            const field = instances[instances.length - 1 - taken];
            if (field) data += canonHeader(field, headerMode) + '\r\n';
        }
        const strippedValue = signature.rawValue.replace(/(^|;)([ \t\r\n]*b[ \t\r\n]*=)[^;]*/, '$1$2');
        data += canonHeader({ name: signature.name, rawValue: strippedValue, raw: `${signature.name}:${strippedValue}` }, headerMode);

        const record = await lookup(check.selector, domain);
        if (!record.p) throw new Error('The domain has revoked this key');
        const key = await importKey(record.p, hash);
        const ok = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, binaryToBytes(atob(tags.b)), binaryToBytes(data));
        check.status = ok ? 'pass' : 'fail';
        check.reason = ok
            ? check.alignedWithFrom ? `Signed by ${domain}, the domain in From` : `Signed by ${domain}, but From says ${fromDomain}`
            : 'Headers changed after the bank signed them, or the key does not match';
    } catch (error) {
        check.status = 'error';
        check.reason = error instanceof Error ? error.message : String(error);
    }
    return check;
}

export async function verifyDkim(mail: Mail, now = Date.now(), lookup: KeyLookup = lookupKeyRecord): Promise<DkimSummary> {
    const fromDomain = fromDomainOf(headerValue(mail.headers, 'from'));
    const signatures = mail.headers.filter((f) => f.name.toLowerCase() === 'dkim-signature');
    if (!signatures.length) return { status: 'none', fromDomain, checks: [], best: null };
    const checks = await Promise.all(signatures.map((s) => verifyOne(mail, s, fromDomain, now, lookup)));
    const best = checks.find((c) => c.status === 'pass' && c.alignedWithFrom)
        ?? checks.find((c) => c.status === 'pass')
        ?? checks[0];
    return { status: best.status, fromDomain, checks, best };
}
