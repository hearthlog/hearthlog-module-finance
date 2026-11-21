/**
 * Account identifiers in one comparable form. Czech domestic numbers ([prefix-]number/bank) become their IBAN, IBANs
 * are cleaned, masked card numbers get a card key. Checksums (mod 11 for Czech numbers, mod 97 for IBANs) catch a
 * misread digit instead of linking to the wrong account. Shared by the mail handler and the statement import, so both
 * name an account the same way.
 */

// Leading zeros beyond the 6- and 10-digit widths are tolerated and stripped.
const CZ_DOMESTIC = /^(?:0*(\d{1,6})-)?0*(\d{1,10})\/(\d{4})$/;
const IBAN = /^[A-Z]{2}\d{2}[A-Z0-9]{10,30}$/;
const CARD = /^(\d{4,6})\*{2,}(\d{4})$/;

const NUMBER_WEIGHTS = [6, 3, 7, 9, 10, 5, 8, 4, 2, 1];
const PREFIX_WEIGHTS = [10, 5, 8, 4, 2, 1];

export interface AccountKey {
    /** The comparable key: the IBAN, `CARD:<first>…<last4>`, or `TEXT:<as written>`. */
    key: string;
    kind: 'iban' | 'cz' | 'card' | 'unknown';
    iban: string | null;
    /** Whether the checksums hold; null where there is none. */
    valid: boolean | null;
    display: string;
}

function mod11(part: string, weights: number[]): boolean {
    const digits = part.padStart(weights.length, '0');
    let sum = 0;
    for (let i = 0; i < weights.length; i++) sum += Number(digits[i]) * weights[i]!;
    return sum % 11 === 0;
}

/** IBAN check per ISO 13616: move the first four characters to the end, letters to numbers, remainder 1 by 97. */
function ibanRemainder(iban: string): number {
    const moved = iban.slice(4) + iban.slice(0, 4);
    let remainder = 0;
    for (const ch of moved) {
        const value = /[A-Z]/.test(ch) ? String(ch.charCodeAt(0) - 55) : ch;
        for (const digit of value) remainder = (remainder * 10 + Number(digit)) % 97;
    }
    return remainder;
}

export function czechIban(prefix: string, number: string, bank: string): string {
    const bban = bank + prefix.padStart(6, '0') + number.padStart(10, '0');
    const check = 98 - ibanRemainder(`CZ00${bban}`);
    return `CZ${String(check).padStart(2, '0')}${bban}`;
}

export function normalizeAccount(text: string | null | undefined): AccountKey | null {
    if (!text) return null;
    const compact = String(text).replace(/[\s ]/g, '').toUpperCase();
    if (!compact) return null;

    const domestic = compact.match(CZ_DOMESTIC);
    if (domestic) {
        const [, prefix = '', number = '', bank = ''] = domestic;
        const valid = mod11(number, NUMBER_WEIGHTS) && (!prefix || mod11(prefix, PREFIX_WEIGHTS));
        const iban = czechIban(prefix, number, bank);
        const shortPrefix = prefix.replace(/^0+/, '');
        return { key: iban, kind: 'cz', iban, valid, display: `${shortPrefix ? `${shortPrefix}-` : ''}${number.replace(/^0+/, '')}/${bank}` };
    }
    if (IBAN.test(compact)) {
        return { key: compact, kind: 'iban', iban: compact, valid: ibanRemainder(compact) === 1, display: compact.replace(/(.{4})/g, '$1 ').trim() };
    }
    const card = compact.match(CARD);
    if (card) return { key: `CARD:${card[1]}…${card[2]}`, kind: 'card', iban: null, valid: null, display: `${card[1]}••••${card[2]}` };
    return { key: `TEXT:${compact}`, kind: 'unknown', iban: null, valid: null, display: String(text).trim() };
}

/** The comparable key, or '' when there is nothing to compare. */
export function accountKey(text: string | null | undefined): string {
    return normalizeAccount(text)?.key ?? '';
}

export function sameAccount(a: string | null | undefined, b: string | null | undefined): boolean {
    const ka = accountKey(a);
    return !!ka && ka === accountKey(b);
}
