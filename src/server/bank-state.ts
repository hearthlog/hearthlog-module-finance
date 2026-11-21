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

/** One account a bank approval shares. */
export interface EbAccount {
    /** Enable Banking's id for the account inside this approval; it changes with every renewal. */
    uid: string;
    /** The normalised account number (or `EB:<identification hash>`): the same across renewals, so the asset stays. */
    key: string;
    currency: string;
    name: string;
}

/** One approval at a bank: what the sync needs and never shows (the session id stays in the gateway). */
export interface EbSession {
    connectionId: string;
    bank: string;
    sessionId: string;
    validUntil: string;
    accounts: EbAccount[];
    /** The last fetch without the user present; the bank allows about four a day. */
    lastBackgroundAt: string | null;
    /** The last fetch with the user present (refresh, opening Finance); throttled to one per five minutes. */
    lastPresentAt: string | null;
    /** After the bank's rate limit: no background fetch before this. */
    nextTryAt: string | null;
    /** Per account key, the latest booked day seen: the next fetch starts a week before it. */
    lastBooked: Record<string, string>;
    status: 'active' | 'expired';
}

/** An approval started but not finished: the random state the bank sends back with the user. */
export interface EbPending {
    bank: string;
    createdAt: string;
}

export interface EbStateStore {
    putPending(state: string, pending: EbPending): Promise<void>;
    /** Returns and forgets the pending approval; null when unknown or older than an hour. */
    takePending(state: string, now: number): Promise<EbPending | null>;
    putSession(session: EbSession): Promise<void>;
    getSession(connectionId: string): Promise<EbSession | null>;
    listSessions(): Promise<EbSession[]>;
}

export const PENDING_MAX_MS = 3_600_000;

export function memoryEbState(): EbStateStore & { pending: Map<string, EbPending>; sessions: Map<string, EbSession> } {
    const pending = new Map<string, EbPending>();
    const sessions = new Map<string, EbSession>();
    return {
        pending,
        sessions,
        async putPending(state, value) {
            pending.set(state, value);
        },
        async takePending(state, now) {
            const value = pending.get(state) ?? null;
            pending.delete(state);
            return value && now - Date.parse(value.createdAt) <= PENDING_MAX_MS ? value : null;
        },
        async putSession(session) {
            sessions.set(session.connectionId, structuredClone(session));
        },
        async getSession(connectionId) {
            const session = sessions.get(connectionId);
            return session ? structuredClone(session) : null;
        },
        async listSessions() {
            return [...sessions.values()].map((session) => structuredClone(session));
        },
    };
}
