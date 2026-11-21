import { describe, expect, it } from 'vitest';
import { matchPlans, NO_MATCH, scorePlan, suggestTransfers, type MatchPlan, type MatchRow, type TransferAccount } from './matching.js';

const row = (fields: Partial<MatchRow>): MatchRow => ({ id: 'r', amount: -18_500, date: '2026-11-13', name: 'TRVALÝ PŘÍKAZ NÁJEM', bankText: 'TRVALÝ PŘÍKAZ NÁJEM', assetId: 'current', counterparty: '', ...fields });
const plan = (fields: Partial<MatchPlan>): MatchPlan => ({ id: 'rent', amount: -18_500, date: '2026-11-16', name: 'Rent', category: 'housing', assetId: '', ...fields });
const none = () => new Set<string>();

describe('a bank row against a plan', () => {
    it('fits the same amount a few days early, and says why', () => {
        expect(scorePlan(row({}), plan({}), false)).toMatchObject({ planId: 'rent', why: 'Same amount · 3 days early' });
        expect(scorePlan(row({}), plan({}), true)?.why).toBe('Same amount · 3 days early · you confirmed this pair before');
    });

    it('allows 2 % or 50 Kč off, and no more than five days', () => {
        expect(scorePlan(row({ amount: -18_800 }), plan({}), false)).not.toBeNull(); // 300 off, 2 % is 370
        expect(scorePlan(row({ amount: -18_900 }), plan({}), false)).toBeNull();
        expect(scorePlan(row({ amount: -640 }), plan({ amount: -599 }), false)).not.toBeNull(); // 41 off, 50 Kč floor
        expect(scorePlan(row({ date: '2026-11-10' }), plan({}), false)).toBeNull(); // six days
    });

    it('never fits the other sign or a plan tied to another account', () => {
        expect(scorePlan(row({ amount: 18_500 }), plan({}), false)).toBeNull();
        expect(scorePlan(row({}), plan({ assetId: 'savings' }), false)).toBeNull();
        expect(scorePlan(row({}), plan({ assetId: 'current' }), false)).not.toBeNull();
    });
});

describe('matching a batch', () => {
    it('gives each plan to its best row once and marks the rest as checked', () => {
        const rows = [row({ id: 'early', date: '2026-11-12' }), row({ id: 'close', date: '2026-11-15' }), row({ id: 'coffee', amount: -89, name: 'Kavárna' })];
        const result = matchPlans(rows, [plan({})], none);
        expect(result.map((match) => [match.rowId, match.planId])).toEqual([['close', 'rent'], ['early', NO_MATCH], ['coffee', NO_MATCH]]);
    });

    it('prefers the plan the same bank text was confirmed as before', () => {
        const rows = [row({ id: 'payment', amount: -2_350, bankText: 'PRE ELEKTŘINA', name: 'PRE ELEKTŘINA' })];
        const plans = [plan({ id: 'internet', name: 'Internet', amount: -2_350, date: '2026-11-13' }), plan({ id: 'power', name: 'Electricity', amount: -2_350, date: '2026-11-15' })];
        const confirmed = (text: string) => new Set(text === 'PRE ELEKTŘINA' ? ['electricity'] : []);
        expect(matchPlans(rows, plans, confirmed)[0]).toMatchObject({ planId: 'power' });
        expect(matchPlans(rows, plans, none)[0]).toMatchObject({ planId: 'internet' });
    });
});

describe('transfers', () => {
    const accounts: TransferAccount[] = [
        { id: 'current', name: 'ČSOB Běžný účet', accountKey: 'CZ8303000000000123456702' },
        { id: 'savings', name: 'ČSOB Spořicí', accountKey: 'CZ0230300000000123456710' },
        { id: 'cash', name: 'Cash', accountKey: '' },
    ];

    it('pairs equal opposite amounts on two accounts, the named counterparty first', () => {
        const out = row({ id: 'out', amount: -10_000, date: '2026-11-12', name: 'To savings', counterparty: 'ČSOB Spořicí · 123456710/3030' });
        const into = row({ id: 'in', amount: 10_000, date: '2026-11-12', assetId: 'savings', name: 'From current' });
        const [suggestion] = suggestTransfers([out, into], accounts);
        expect(suggestion).toMatchObject({ kind: 'pair', amount: 10_000, why: 'Equal amounts on the same day · the counterparty is your ČSOB Spořicí' });
    });

    it('waits for the other side when only one has arrived but names an own account', () => {
        const out = row({ id: 'out', amount: -10_000, counterparty: '123456710/3030' });
        expect(suggestTransfers([out], accounts)).toMatchObject([{ kind: 'own', toAssetId: 'savings' }]);
    });

    it('sends cash withdrawals to the hand-kept Cash asset, and not without one', () => {
        const atm = row({ id: 'atm', amount: -2_000, name: 'Výběr z bankomatu', bankText: 'VÝBĚR Z BANKOMATU' });
        expect(suggestTransfers([atm], accounts)).toMatchObject([{ kind: 'cash', toAssetId: 'cash', amount: 2_000 }]);
        expect(suggestTransfers([atm], accounts.filter((account) => account.id !== 'cash'))).toEqual([]);
    });

    it('leaves ordinary payments and same-account pairs alone', () => {
        const shop = row({ id: 'shop', amount: -742, name: 'Lidl', bankText: 'LIDL' });
        const refund = row({ id: 'refund', amount: 742, name: 'Lidl refund' });
        expect(suggestTransfers([shop, refund], accounts)).toEqual([]);
    });
});
