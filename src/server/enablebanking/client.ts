/**
 * Calls to Enable Banking, signed with the application key the site keeps as Worker secrets. A call without PSU
 * headers is a background fetch (the bank allows about four a day); a call made while the user is in the app passes
 * their IP and user agent, and does not count against that limit.
 */

import { applicationToken } from './jwt.js';

export const EB_API = 'https://api.enablebanking.com';

export interface EbConfig {
    appId: string;
    privateKey: string;
    /** Tests pass their own; production uses the Worker's fetch. */
    fetch?: typeof fetch;
}

/** The secrets Finance reads; both must be set before Revolut can be linked. */
export interface EbEnv {
    FINANCE_EB_APP_ID?: string;
    FINANCE_EB_PRIVATE_KEY?: string;
}

export function ebConfig(env: EbEnv): EbConfig | null {
    const appId = env.FINANCE_EB_APP_ID?.trim();
    const privateKey = env.FINANCE_EB_PRIVATE_KEY;
    return appId && privateKey ? { appId, privateKey } : null;
}

export type PsuHeaders = Record<string, string>;

/** The headers that tell the bank the account holder is present, from the user's own request. */
export function psuHeadersFrom(request: Request): PsuHeaders {
    const headers: PsuHeaders = {};
    const ip = request.headers.get('cf-connecting-ip');
    if (ip) headers['Psu-Ip-Address'] = ip;
    for (const [psu, own] of [['Psu-User-Agent', 'user-agent'], ['Psu-Accept', 'accept'], ['Psu-Accept-Language', 'accept-language']] as const) {
        const value = request.headers.get(own);
        if (value) headers[psu] = value;
    }
    return headers;
}

export class EbError extends Error {
    constructor(readonly status: number, readonly code: string, message: string) {
        super(message);
    }
}

export async function ebCall<T>(
    config: EbConfig,
    method: 'GET' | 'POST' | 'DELETE',
    path: string,
    options: { query?: Record<string, string | undefined>; body?: unknown; psu?: PsuHeaders; now?: number } = {},
): Promise<T> {
    const url = new URL(EB_API + path);
    for (const [key, value] of Object.entries(options.query ?? {})) if (value) url.searchParams.set(key, value);
    const response = await (config.fetch ?? fetch)(url, {
        method,
        headers: {
            authorization: `Bearer ${await applicationToken(config.appId, config.privateKey, options.now)}`,
            accept: 'application/json',
            ...(options.body === undefined ? {} : { 'content-type': 'application/json' }),
            ...options.psu,
        },
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
    });
    const text = await response.text();
    let body: unknown = null;
    try {
        body = text ? JSON.parse(text) : null;
    } catch {
        body = text;
    }
    if (!response.ok) {
        const error = body && typeof body === 'object' ? body as { error?: unknown; message?: unknown } : {};
        throw new EbError(response.status, typeof error.error === 'string' ? error.error : `HTTP_${response.status}`, typeof error.message === 'string' ? error.message : 'Enable Banking refused the call');
    }
    return body as T;
}
