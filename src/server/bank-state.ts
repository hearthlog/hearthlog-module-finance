/**
 * What the mail handler remembers between mails, per integration: the messages it has already taken (so a mail that
 * arrives twice is one row) and, per account, the last balance it saw (so a missing mail shows as a gap). The ledger
 * holds everything the user sees; this holds only what the next mail needs. Production keeps it in a Durable Object
 * (bank-state-object.ts); tests use the in-memory one.
 */

export interface AccountChain {
    /** The balance after the last mail Finance took for this account (stated by the bank, or counted). */
    balance: number;
    /** When that balance applied, ISO. A mail about an earlier moment never moves the balance back. */
    at: string;
}

export interface BankStateStore {
    /** Records the message as taken; false when it was taken before. */
    claimMessage(key: string): Promise<boolean>;
    /** Forgets a claim whose writing failed, so the redelivered mail is taken again. */
    releaseMessage(key: string): Promise<void>;
    readChain(account: string): Promise<AccountChain | null>;
    writeChain(account: string, chain: AccountChain): Promise<void>;
}

export function memoryBankState(): BankStateStore & { messages: Set<string>; chains: Map<string, AccountChain> } {
    const messages = new Set<string>();
    const chains = new Map<string, AccountChain>();
    return {
        messages,
        chains,
        async claimMessage(key) {
            if (messages.has(key)) return false;
            messages.add(key);
            return true;
        },
        async releaseMessage(key) {
            messages.delete(key);
        },
        async readChain(account) {
            return chains.get(account) ?? null;
        },
        async writeChain(account, chain) {
            chains.set(account, chain);
        },
    };
}
