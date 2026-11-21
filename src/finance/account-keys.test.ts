import { describe, expect, it } from 'vitest';
import { accountKey, normalizeAccount, sameAccount } from './account-keys.js';

// Made-up account numbers that satisfy the Czech mod-11 rule; never a real person's account.
describe('account normalisation', () => {
    it('turns Czech domestic numbers into their IBAN', () => {
        expect(normalizeAccount('123456702/0300')).toMatchObject({ kind: 'cz', iban: 'CZ8303000000000123456702', valid: true });
        expect(normalizeAccount('123456710 / 3030')).toMatchObject({ kind: 'cz', iban: 'CZ0230300000000123456710', valid: true });
    });

    it('treats every way of writing an account as the same account', () => {
        expect(sameAccount('123456702/0300', 'CZ83 0300 0000 0001 2345 6702')).toBe(true);
        expect(sameAccount('0000123456702/0300', '123456702/0300')).toBe(true);
        expect(sameAccount('107-1000000005/6210', 'CZ05 6210 0001 0710 0000 0005')).toBe(true);
        expect(sameAccount('115-1000000013/0800', '000115-1000000013/0800')).toBe(true);
        expect(sameAccount('123456702/0300', '123456702/0100')).toBe(false);
    });

    it('keeps prefixed accounts apart from unprefixed ones', () => {
        expect(accountKey('107-1000000005/6210')).not.toBe(accountKey('1000000005/6210'));
    });

    it('catches a misread digit with the checksums', () => {
        expect(normalizeAccount('123456703/0300')?.valid).toBe(false);
        expect(normalizeAccount('CZ8303000000000123456703')?.valid).toBe(false);
        expect(normalizeAccount('LT12 1000 0111 0100 1000')?.valid).toBe(true);
    });

    it('gives masked cards their own key and leaves other text comparable', () => {
        expect(normalizeAccount('400000******0042')).toMatchObject({ kind: 'card', key: 'CARD:400000…0042' });
        expect(normalizeAccount('INV-26-0001')?.kind).toBe('unknown');
        expect(accountKey('')).toBe('');
        expect(accountKey(null)).toBe('');
    });
});
