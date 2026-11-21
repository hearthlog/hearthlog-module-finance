/**
 * The application token Enable Banking expects on every call: RS256, `kid` =
 * application id, at most 24 hours. Signed with the site's Worker secret.
 */

import { derLength, RSA_ALGORITHM } from '../mail/der.js';

const encoder = new TextEncoder();

export function base64url(bytes: Uint8Array): string {
    let text = '';
    for (const byte of bytes) text += String.fromCharCode(byte);
    return btoa(text).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** PEM text to DER. Accepts real newlines or literal "\n", as .dev.vars may keep either. */
export function pemToDer(pem: string): { der: Uint8Array; pkcs1: boolean } {
    const text = pem.replace(/\\n/g, '\n');
    if (!/-----BEGIN (RSA )?PRIVATE KEY-----/.test(text)) throw new Error('The private key is not a PEM private key');
    const body = text.replace(/-----[^-]+-----/g, '').replace(/[^A-Za-z0-9+/=]/g, '');
    return { der: Uint8Array.from(atob(body), (c) => c.charCodeAt(0)), pkcs1: /BEGIN RSA PRIVATE KEY/.test(text) };
}

/** A PKCS#1 RSAPrivateKey (older OpenSSL) wrapped as PKCS#8, the only form WebCrypto imports. */
function wrapPkcs8(pkcs1: Uint8Array): Uint8Array {
    const octets = [0x04, ...derLength(pkcs1.length), ...pkcs1];
    const body = [0x02, 0x01, 0x00, ...RSA_ALGORITHM, ...octets];
    return new Uint8Array([0x30, ...derLength(body.length), ...body]);
}

const keys = new Map<string, Promise<CryptoKey>>();

function signingKey(appId: string, pem: string): Promise<CryptoKey> {
    let key = keys.get(appId);
    if (!key) {
        const { der, pkcs1 } = pemToDer(pem);
        key = crypto.subtle.importKey('pkcs8', pkcs1 ? wrapPkcs8(der) : der, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
        keys.set(appId, key);
        key.catch(() => keys.delete(appId));
    }
    return key;
}

export async function applicationToken(appId: string, pem: string, now = Date.now()): Promise<string> {
    const iat = Math.floor(now / 1000);
    const header = base64url(encoder.encode(JSON.stringify({ typ: 'JWT', alg: 'RS256', kid: appId })));
    const payload = base64url(encoder.encode(JSON.stringify({ iss: 'enablebanking.com', aud: 'api.enablebanking.com', iat, exp: iat + 3600 })));
    const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', await signingKey(appId, pem), encoder.encode(`${header}.${payload}`));
    return `${header}.${payload}.${base64url(new Uint8Array(signature))}`;
}
