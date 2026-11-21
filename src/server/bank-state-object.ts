import { DurableObject } from '@hearthlog/sdk/server';
import { PENDING_MAX_MS, type AccountChain, type BankStateStore, type EbPending, type EbSession, type EbStateStore } from './bank-state.js';

/** Messages are remembered this long; a bank never redelivers a mail later than that. */
const MESSAGE_DAYS = 120;

/**
 * Finance's private storage in the gateway: one object per mail integration (`idFromName(integration id)`), a small
 * SQLite database with the messages taken and each account's last balance. Holds no mail text and no credential.
 */
export class FinanceBankState extends DurableObject<unknown> {
    private ready = false;

    private schema(): void {
        if (this.ready) return;
        this.ctx.storage.sql.exec(`
            CREATE TABLE IF NOT EXISTS messages (key TEXT PRIMARY KEY, taken_at INTEGER NOT NULL);
            CREATE TABLE IF NOT EXISTS chains (account TEXT PRIMARY KEY, balance REAL NOT NULL, at TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS eb_pending (state TEXT PRIMARY KEY, value TEXT NOT NULL, created_at INTEGER NOT NULL);
            CREATE TABLE IF NOT EXISTS eb_sessions (connection_id TEXT PRIMARY KEY, value TEXT NOT NULL);
        `);
        this.ready = true;
    }

    async claimMessage(key: string): Promise<boolean> {
        this.schema();
        const now = Date.now();
        this.ctx.storage.sql.exec('DELETE FROM messages WHERE taken_at < ?', now - MESSAGE_DAYS * 86_400_000);
        const cursor = this.ctx.storage.sql.exec('INSERT OR IGNORE INTO messages (key, taken_at) VALUES (?, ?)', key, now);
        return cursor.rowsWritten > 0;
    }

    async releaseMessage(key: string): Promise<void> {
        this.schema();
        this.ctx.storage.sql.exec('DELETE FROM messages WHERE key = ?', key);
    }

    async readChain(account: string): Promise<AccountChain | null> {
        this.schema();
        const row = this.ctx.storage.sql.exec<{ balance: number; at: string }>('SELECT balance, at FROM chains WHERE account = ?', account).toArray()[0];
        return row ? { balance: Number(row.balance), at: String(row.at) } : null;
    }

    async writeChain(account: string, chain: AccountChain): Promise<void> {
        this.schema();
        this.ctx.storage.sql.exec(
            'INSERT INTO chains (account, balance, at) VALUES (?, ?, ?) ON CONFLICT(account) DO UPDATE SET balance = excluded.balance, at = excluded.at',
            account, chain.balance, chain.at,
        );
    }

    async putPending(state: string, pending: EbPending): Promise<void> {
        this.schema();
        this.ctx.storage.sql.exec('DELETE FROM eb_pending WHERE created_at < ?', Date.now() - PENDING_MAX_MS);
        this.ctx.storage.sql.exec('INSERT OR REPLACE INTO eb_pending (state, value, created_at) VALUES (?, ?, ?)', state, JSON.stringify(pending), Date.parse(pending.createdAt));
    }

    async takePending(state: string, now: number): Promise<EbPending | null> {
        this.schema();
        const row = this.ctx.storage.sql.exec<{ value: string; created_at: number }>('SELECT value, created_at FROM eb_pending WHERE state = ?', state).toArray()[0];
        this.ctx.storage.sql.exec('DELETE FROM eb_pending WHERE state = ?', state);
        return row && now - Number(row.created_at) <= PENDING_MAX_MS ? JSON.parse(String(row.value)) as EbPending : null;
    }

    async putSession(session: EbSession): Promise<void> {
        this.schema();
        this.ctx.storage.sql.exec('INSERT OR REPLACE INTO eb_sessions (connection_id, value) VALUES (?, ?)', session.connectionId, JSON.stringify(session));
    }

    async getSession(connectionId: string): Promise<EbSession | null> {
        this.schema();
        const row = this.ctx.storage.sql.exec<{ value: string }>('SELECT value FROM eb_sessions WHERE connection_id = ?', connectionId).toArray()[0];
        return row ? JSON.parse(String(row.value)) as EbSession : null;
    }

    async listSessions(): Promise<EbSession[]> {
        this.schema();
        return this.ctx.storage.sql.exec<{ value: string }>('SELECT value FROM eb_sessions').toArray().map((row) => JSON.parse(String(row.value)) as EbSession);
    }
}

/** The approval store for one integration, through the object's RPC methods. */
export function durableEbState(namespace: DurableObjectNamespace<FinanceBankState>, integrationId: string): EbStateStore {
    const stub = namespace.get(namespace.idFromName(integrationId));
    return {
        putPending: (state, pending) => stub.putPending(state, pending),
        takePending: (state, now) => stub.takePending(state, now),
        putSession: (session) => stub.putSession(session),
        getSession: (connectionId) => stub.getSession(connectionId),
        listSessions: () => stub.listSessions(),
    };
}

/** The store for one integration, through the object's RPC methods. */
export function durableBankState(namespace: DurableObjectNamespace<FinanceBankState>, integrationId: string): BankStateStore {
    const stub = namespace.get(namespace.idFromName(integrationId));
    return {
        claimMessage: (key) => stub.claimMessage(key),
        releaseMessage: (key) => stub.releaseMessage(key),
        readChain: (account) => stub.readChain(account),
        writeChain: (account, chain) => stub.writeChain(account, chain),
    };
}
