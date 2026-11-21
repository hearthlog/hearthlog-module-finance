/**
 * Entity ids derived from what a bank says, shared by the mail handler (gateway) and the statement import (browser),
 * so a payment that arrives both ways is one entity. The derivation is the SDK's `deterministicUuid` (version 5
 * layout over SHA-256), repeated here because the browser cannot import the gateway's SDK entry.
 */

export async function stableUuid(...parts: readonly string[]): Promise<string> {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(parts.join('\u0000')));
    const bytes = new Uint8Array(digest).slice(0, 16);
    bytes[6] = (bytes[6]! & 0x0f) | 0x50;
    bytes[8] = (bytes[8]! & 0x3f) | 0x80;
    const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function connectionIdFor(integrationId: string, bankId: string): Promise<string> {
    return stableUuid('finance-bank-connection', integrationId, bankId);
}

export function assetIdFor(integrationId: string, account: string): Promise<string> {
    return stableUuid('finance-bank-asset', integrationId, account);
}

/** The same payment, whether it came by mail or from a statement: the account and the bank's reference. */
export function transactionIdFor(account: string, bankRef: string): Promise<string> {
    return stableUuid('finance-bank-row', account, bankRef);
}

/** A bank's own reference for a row: `<bank id>:<code>`. */
export function bankRefFor(bankId: string, reference: string): string {
    return `${bankId}:${reference}`;
}
