/**
 * The browser's side of linking by bank approval (Revolut): the gateway starts the trip to the bank and finishes it
 * when the bank sends the user back; the browser only asks for the bank's page and, while Finance is open, for a
 * fresh fetch (the gateway allows one per five minutes; it is the user's own, so it does not count against the bank's
 * daily limit for background fetches).
 */

const BASE = '/api/finance/bank/v1/eb';

export class BankApprovalError extends Error {}

/** Goes to the bank's approval page; the bank sends the user back to Finance when done. */
export async function startBankApproval(bank = 'revolut'): Promise<void> {
    const response = await fetch(`${BASE}/start`, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ bank }),
    });
    const body = await response.json().catch(() => ({})) as { url?: string; error?: string };
    if (!response.ok || !body.url) throw new BankApprovalError(body.error ?? 'The bank could not be reached');
    window.location.assign(body.url);
}

/** Asks the gateway to fetch every approval now; quiet when nothing is due or the site has no approvals. */
export async function refreshBankApprovals(): Promise<void> {
    await fetch(`${BASE}/refresh`, { method: 'POST', credentials: 'same-origin', headers: { Accept: 'application/json' } }).catch(() => undefined);
}

/** What the bank's return says, read once from the address and removed from it. */
export function takeApprovalReturn(url: URL): { linked: string } | { error: string } | null {
    const linked = url.searchParams.get('bankLinked');
    const error = url.searchParams.get('bankLinkError');
    if (!linked && !error) return null;
    url.searchParams.delete('bankLinked');
    url.searchParams.delete('bankLinkError');
    return linked ? { linked } : { error: error! };
}

export function approvalErrorText(code: string): string {
    switch (code) {
        case 'cancelled':
        case 'access_denied': return 'The approval was cancelled at the bank; nothing was linked.';
        case 'expired': return 'The approval took too long; start it again.';
        default: return 'The bank could not finish the approval; try again in a moment.';
    }
}
