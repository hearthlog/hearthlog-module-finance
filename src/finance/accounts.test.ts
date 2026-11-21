import { describe, expect, it } from 'vitest';
import { orderAccounts, overviewOf, summarizeAccount, type AccountAsset, type AccountConnection } from './accounts.js';

/** The States board, row by row, from fields alone. */

const NOW = new Date('2026-11-15T11:42:00Z');
const csob: AccountConnection = { id: 'c1', bank: 'csob', provider: 'email', status: 'active' };
const airbank: AccountConnection = { id: 'c2', bank: 'airbank', provider: 'email', status: 'active' };
const revolut: AccountConnection = { id: 'c3', bank: 'revolut', provider: 'enable_banking', status: 'active', valid_until: '2027-02-10T00:00:00Z' };

const linked = (fields: Partial<AccountAsset>): AccountAsset => ({
    id: 'a', name: 'ČSOB Běžný účet', amount: 84_310, link: 'bank', provider: 'email', account_kind: 'current',
    synced_at: '2026-11-15T11:30:00Z', ...fields,
});

describe('linked by email', () => {
    it('is current while mails arrive', () => {
        expect(summarizeAccount(linked({}), csob, NOW)).toMatchObject({
            state: 'current', tone: 'ok', stamp: 'Last email 12 min ago', detail: 'Current · email 12 min ago', bank: { mark: 'ČS' },
        });
    });

    it('turns quiet after a week without mail', () => {
        const air = linked({ name: 'Air Bank', amount: 12_480, synced_at: '2026-11-06T08:00:00Z' });
        expect(summarizeAccount(air, airbank, NOW)).toMatchObject({ state: 'quiet', tone: 'stale', stamp: 'No email for 9 days' });
        expect(summarizeAccount({ ...air, synced_at: '2026-11-09T08:00:00Z' }, airbank, NOW).state).toBe('current');
    });

    it('asks for a look at a mail it could not read', () => {
        const card = linked({ name: 'ČSOB kreditní karta', amount: -6_240, account_kind: 'card', sync_issue: 'unread_mail', issue_count: 1 });
        expect(summarizeAccount(card, csob, NOW)).toMatchObject({ state: 'unread', tone: 'stale', stamp: '1 email to look at' });
    });

    it('names a gap between the stated balance and the rows', () => {
        const gap = linked({ amount: 83_070, sync_issue: 'balance_gap', issue_amount: -1_240 });
        const result = summarizeAccount(gap, csob, NOW);
        expect(result).toMatchObject({ state: 'gap', tone: 'dead' });
        // Amounts keep their digits together with a non-breaking space.
        expect(result.stamp.replace(/\u00a0/g, ' ')).toBe('1 240 Kč unexplained');
    });

    it('says a card is owed', () => {
        const card = linked({ name: 'ČSOB kreditní karta', amount: -6_240, account_kind: 'card', synced_at: '2026-11-14T19:00:00Z' });
        expect(summarizeAccount(card, csob, NOW).detail).toBe('Card, owed · email yesterday');
    });
});

describe('linked by bank approval', () => {
    const eur = linked({ name: 'Revolut EUR', amount: 10_020, provider: 'enable_banking', currency: 'EUR', native_amount: 412.5, synced_at: '2026-11-15T09:40:00Z' });

    it('shows the native amount while current', () => {
        expect(summarizeAccount(eur, revolut, NOW)).toMatchObject({ state: 'current', detail: '412,50 € · synced 2 h ago', bank: { mark: 'RE' } });
    });

    it('waits for the next try when the bank limit is reached', () => {
        const limited = { ...revolut, status: 'rate_limited', next_try_at: '2026-11-15T17:00:00Z' };
        const result = summarizeAccount({ ...eur, synced_at: '2026-11-15T04:40:00Z' }, limited, NOW);
        expect(result).toMatchObject({ state: 'limit', tone: 'stale' });
        expect(result.stamp).toMatch(/^7 h ago · next try \d\d:00$/);
        expect(summarizeAccount(eur, { ...limited, next_try_at: '2026-11-15T10:00:00Z' }, NOW).state).toBe('current');
    });

    it('asks to renew two weeks before the approval ends', () => {
        expect(summarizeAccount(eur, { ...revolut, valid_until: '2026-11-29T00:00:00Z' }, NOW)).toMatchObject({ state: 'renew', stamp: 'Renew by 29 Nov' });
    });

    it('freezes the balance once the approval has ended', () => {
        const stale = { ...eur, synced_at: '2026-11-09T10:00:00Z' };
        expect(summarizeAccount(stale, { ...revolut, valid_until: '2026-11-10T00:00:00Z' }, NOW)).toMatchObject({
            state: 'expired', tone: 'dead', frozen: true, stamp: 'Not syncing since 9 Nov',
        });
        expect(summarizeAccount(stale, { ...revolut, status: 'revoked' }, NOW).state).toBe('expired');
    });
});

describe('the readout over every account', () => {
    const assets: AccountAsset[] = [
        linked({ id: '1' }),
        linked({ id: '2', name: 'ČSOB Spořicí', account_kind: 'savings', synced_at: '2026-11-12T10:00:00Z' }),
        linked({ id: '3', name: 'Air Bank', synced_at: '2026-11-15T09:40:00Z' }),
        linked({ id: '4', name: 'ČSOB kreditní karta', amount: -6_240, account_kind: 'card' }),
        linked({ id: '5', name: 'Revolut EUR', provider: 'enable_banking', synced_at: '2026-11-15T09:40:00Z' }),
        { id: '6', name: 'Cash', amount: 3_500, updated_at: '2026-11-02 08:00:00' },
    ];
    const connections = [csob, csob, airbank, csob, revolut, null];
    const accounts = () => assets.map((asset, index) => summarizeAccount(asset, connections[index]!, NOW));

    it('counts the accounts by how they reach Finance and notes the card', () => {
        expect(overviewOf(accounts(), assets, NOW)).toMatchObject({
            breakdown: '4 by email · 1 by bank approval · 1 by hand · card debt subtracted',
            stamp: 'Updated 12 min ago',
            tone: 'ok',
            linked: 5,
        });
        expect(accounts()[5]).toMatchObject({ state: 'manual', tone: 'hand', stamp: 'By hand · 2 Nov' });
    });

    it('says which balance holds the sum back once an approval ends', () => {
        const ended = accounts().map((account, index) => index === 4 ? { ...account, frozen: true, tone: 'dead' as const } : account);
        const withDate = assets.map((asset, index) => index === 4 ? { ...asset, synced_at: '2026-11-09T10:00:00Z' } : asset);
        expect(overviewOf(ended, withDate, NOW)).toMatchObject({ stamp: 'one account as of 9 Nov', tone: 'dead' });
    });

    it('says how many accounts need a look instead of how fresh they are', () => {
        const states = accounts().map((account, index) => index === 0 ? { ...account, tone: 'dead' as const }
            : index === 2 ? { ...account, tone: 'stale' as const } : account);
        expect(overviewOf(states, assets, NOW)).toMatchObject({ stamp: '2 accounts need a look', tone: 'dead' });
        const one = accounts().map((account, index) => index === 2 ? { ...account, tone: 'stale' as const } : account);
        expect(overviewOf(one, assets, NOW)).toMatchObject({ stamp: 'Air Bank needs a look', tone: 'stale' });
    });

    it('lists email accounts, then approvals, then hand-kept ones, each in its own order', () => {
        const shuffled = [accounts()[5]!, accounts()[4]!, accounts()[0]!, accounts()[2]!];
        expect(orderAccounts(shuffled).map((account) => account.name)).toEqual(['ČSOB Běžný účet', 'Air Bank', 'Revolut EUR', 'Cash']);
    });
});
