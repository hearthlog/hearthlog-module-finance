/**
 * What the accounts strip, the account drawer and the readout say about each asset, worked out from its fields
 * alone: linked or by hand, which provider, how fresh, and which state from the States board it is in. Pure, so the
 * same rules hold on every screen and in tests.
 */

import { differenceInCalendarDays, differenceInMinutes, format, parseISO } from 'date-fns';
import { formatAmount } from '@hearthlog/sdk/format';
import { bankInfo, PROVIDER_LABELS, type BankInfo, type BankProvider } from './banks.js';

/** The asset fields this reads; the generated row type has them all. */
export interface AccountAsset {
    id: string;
    name: string;
    amount: number;
    updated_at?: string | null;
    link?: string | null;
    provider?: string | null;
    connection_id?: string | null;
    account_kind?: string | null;
    account_hash?: string | null;
    currency?: string | null;
    native_amount?: number | null;
    synced_at?: string | null;
    sync_issue?: string | null;
    issue_count?: number | null;
    issue_amount?: number | null;
}

export interface AccountConnection {
    id: string;
    bank: string;
    provider: string;
    status?: string | null;
    valid_until?: string | null;
    next_try_at?: string | null;
    last_sync_at?: string | null;
    last_error?: string | null;
    address?: string | null;
    rows_since?: string | null;
}

export type AccountState =
    /** Kept by hand: the balance is whatever was typed. */
    | 'manual'
    /** Linked and fresh. */
    | 'current'
    /** Email: no mail for longer than the account's habit. */
    | 'quiet'
    /** Email: a mail Finance could not read waits for a look. */
    | 'unread'
    /** Email: the stated balance and the rows do not add up. */
    | 'gap'
    /** Bank approval: no more background fetches until the next try. */
    | 'limit'
    /** Bank approval: it ends within two weeks. */
    | 'renew'
    /** Bank approval: ended or revoked; the balance is frozen. */
    | 'expired'
    /** The provider reported an error. */
    | 'error';

export type AccountTone = 'ok' | 'stale' | 'dead' | 'hand';

export interface AccountSummary {
    id: string;
    name: string;
    bank: BankInfo | null;
    linked: boolean;
    provider: BankProvider | null;
    kind: string;
    balance: number;
    state: AccountState;
    tone: AccountTone;
    /** The freshness line with its tone: "Last email 12 min ago", "Renew by 29 Nov". */
    stamp: string;
    /** The strip's small line: kind and freshness while all is well, otherwise the state. */
    detail: string;
    /** The balance no longer follows the bank (shown greyed). */
    frozen: boolean;
    /** Last four characters of the account number, when known. */
    tail: string;
}

/** Days without a mail before an email account counts as quiet. */
export const QUIET_DAYS = 7;
/** Days before a bank approval ends when Finance starts asking to renew it. */
export const RENEW_DAYS = 14;

const KIND_LABELS: Record<string, string> = { current: 'Current', savings: 'Savings', card: 'Card, owed' };
const KIND_LONG: Record<string, string> = { current: 'Current account', savings: 'Savings account', card: 'Credit card' };

export function kindLabel(kind: string): string {
    return KIND_LABELS[kind] ?? 'Account';
}

export function kindLong(kind: string): string {
    return KIND_LONG[kind] ?? 'Account';
}

function parse(value: string | null | undefined): Date | null {
    if (!value) return null;
    const date = parseISO(value.includes('T') || value.length <= 10 ? value : value.replace(' ', 'T') + 'Z');
    return Number.isNaN(date.getTime()) ? null : date;
}

/** "12 min ago", "2 h ago", "yesterday", "3 days ago", "9 Nov". */
export function ago(value: string | null | undefined, now: Date): string {
    const date = parse(value);
    if (!date) return 'never';
    const minutes = Math.max(0, differenceInMinutes(now, date));
    if (minutes < 1) return 'just now';
    if (minutes < 60) return `${minutes} min ago`;
    const days = differenceInCalendarDays(now, date);
    if (days === 0) return `${Math.floor(minutes / 60)} h ago`;
    if (days === 1) return 'yesterday';
    if (days < 7) return `${days} days ago`;
    return format(date, 'd MMM');
}

function day(value: string | null | undefined): string {
    const date = parse(value);
    return date ? format(date, 'd MMM') : '';
}

function money(value: number): string {
    return `${formatAmount(Math.abs(value))} Kč`;
}

function nativeLine(asset: AccountAsset): string {
    const currency = (asset.currency ?? 'CZK').toUpperCase();
    if (currency === 'CZK' || asset.native_amount === null || asset.native_amount === undefined) return '';
    const symbol = currency === 'EUR' ? '€' : currency === 'USD' ? '$' : currency;
    return `${new Intl.NumberFormat('cs-CZ', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(asset.native_amount)} ${symbol}`;
}

export function summarizeAccount(asset: AccountAsset, connection: AccountConnection | null, now: Date): AccountSummary {
    const balance = Number(asset.amount) || 0;
    const base = {
        id: asset.id,
        name: asset.name,
        balance,
        kind: asset.account_kind ?? '',
        tail: (asset.account_hash ?? '').replace(/^CARD:.*…/, '').slice(-4),
    };
    if (asset.link !== 'bank') {
        const stamp = `By hand · ${day(asset.updated_at) || 'not dated'}`;
        return { ...base, bank: null, linked: false, provider: null, state: 'manual', tone: 'hand', stamp, detail: stamp, frozen: false };
    }

    const bank = bankInfo(connection?.bank);
    const provider: BankProvider = (asset.provider ?? connection?.provider) === 'enable_banking' ? 'enable_banking' : 'email';
    const when = ago(asset.synced_at, now);
    const kind = kindLabel(base.kind);
    const native = nativeLine(asset);
    const freshLead = native || kind;
    const linked = { ...base, bank, linked: true, provider } as const;

    if (provider === 'enable_banking') {
        const status = connection?.status ?? 'active';
        const validUntil = parse(connection?.valid_until);
        if (status === 'expired' || status === 'revoked' || (validUntil && validUntil <= now)) {
            const stamp = `Not syncing since ${day(asset.synced_at) || 'linking'}`;
            return { ...linked, state: 'expired', tone: 'dead', stamp, detail: stamp, frozen: true };
        }
        if (status === 'error') {
            const stamp = connection?.last_error ? `Bank error: ${connection.last_error}` : 'Bank error';
            return { ...linked, state: 'error', tone: 'dead', stamp, detail: stamp, frozen: false };
        }
        const nextTry = parse(connection?.next_try_at);
        if (status === 'rate_limited' && nextTry && nextTry > now) {
            const stamp = `${when === 'just now' ? 'Just now' : when} · next try ${format(nextTry, 'HH:mm')}`;
            return { ...linked, state: 'limit', tone: 'stale', stamp, detail: stamp, frozen: false };
        }
        if (validUntil && differenceInCalendarDays(validUntil, now) <= RENEW_DAYS) {
            const stamp = `Renew by ${format(validUntil, 'd MMM')}`;
            return { ...linked, state: 'renew', tone: 'stale', stamp, detail: stamp, frozen: false };
        }
        return { ...linked, state: 'current', tone: 'ok', stamp: `Synced ${when}`, detail: `${freshLead} · synced ${when}`, frozen: false };
    }

    if (connection?.status === 'error') {
        const stamp = connection.last_error ? `Mail error: ${connection.last_error}` : 'Mail error';
        return { ...linked, state: 'error', tone: 'dead', stamp, detail: stamp, frozen: false };
    }
    if (asset.sync_issue === 'balance_gap' && asset.issue_amount) {
        const stamp = `${money(asset.issue_amount)} unexplained`;
        return { ...linked, state: 'gap', tone: 'dead', stamp, detail: stamp, frozen: false };
    }
    if (asset.sync_issue === 'unread_mail') {
        const count = Math.max(1, Number(asset.issue_count) || 0);
        const stamp = `${count} ${count === 1 ? 'email' : 'emails'} to look at`;
        return { ...linked, state: 'unread', tone: 'stale', stamp, detail: stamp, frozen: false };
    }
    const synced = parse(asset.synced_at);
    const quietDays = synced ? differenceInCalendarDays(now, synced) : 0;
    if (quietDays > QUIET_DAYS) {
        const stamp = `No email for ${quietDays} days`;
        return { ...linked, state: 'quiet', tone: 'stale', stamp, detail: stamp, frozen: false };
    }
    return { ...linked, state: 'current', tone: 'ok', stamp: `Last email ${when}`, detail: `${freshLead} · email ${when}`, frozen: false };
}

export interface AccountsOverview {
    /** "4 by email · 1 by bank approval · 1 by hand · card debt subtracted". */
    breakdown: string;
    /** The freshest linked balance ("Updated 12 min ago"), or what holds the sum back ("one account as of 9 Nov"). */
    stamp: string;
    tone: AccountTone;
    linked: number;
}

export function overviewOf(accounts: readonly AccountSummary[], assets: readonly AccountAsset[], now: Date): AccountsOverview {
    const email = accounts.filter((account) => account.provider === 'email').length;
    const approval = accounts.filter((account) => account.provider === 'enable_banking').length;
    const hand = accounts.filter((account) => !account.linked).length;
    const parts = [
        email ? `${email} by email` : '',
        approval ? `${approval} by bank approval` : '',
        hand ? `${hand} by hand` : '',
        accounts.some((account) => account.kind === 'card' && account.balance < 0) ? 'card debt subtracted' : '',
    ].filter(Boolean);
    const frozen = accounts.filter((account) => account.frozen);
    if (frozen.length) {
        const oldest = frozen
            .map((account) => assets.find((asset) => asset.id === account.id)?.synced_at ?? '')
            .filter(Boolean)
            .sort()[0];
        const stamp = `${frozen.length === 1 ? 'one account' : `${frozen.length} accounts`} as of ${day(oldest) || 'linking'}`;
        return { breakdown: parts.join(' · '), stamp, tone: 'dead', linked: email + approval };
    }
    const latest = assets
        .filter((asset) => asset.link === 'bank' && asset.synced_at)
        .map((asset) => asset.synced_at as string)
        .sort()
        .at(-1);
    const needLook = accounts.filter((account) => account.tone === 'dead' || account.tone === 'stale');
    if (needLook.length) {
        const tone: AccountTone = needLook.some((account) => account.tone === 'dead') ? 'dead' : 'stale';
        const stamp = needLook.length === 1 ? `${needLook[0]!.name} needs a look` : `${needLook.length} accounts need a look`;
        return { breakdown: parts.join(' · '), stamp, tone, linked: email + approval };
    }
    const stamp = latest ? `Updated ${ago(latest, now)}` : '';
    return { breakdown: parts.join(' · '), stamp, tone: 'ok', linked: email + approval };
}

/** Linked accounts first (email before bank approval), hand-kept assets after; otherwise in the order given (oldest first). */
export function orderAccounts(accounts: readonly AccountSummary[]): AccountSummary[] {
    const rank = (account: AccountSummary) => (!account.linked ? 2 : account.provider === 'email' ? 0 : 1);
    return accounts.map((account, index) => ({ account, index }))
        .sort((a, b) => rank(a.account) - rank(b.account) || a.index - b.index)
        .map(({ account }) => account);
}
