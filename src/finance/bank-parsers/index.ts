import { airBankInfo } from './airbank.js';
import { csasPayment } from './csas.js';
import { csobMojeInfo } from './csob.js';
import type { BankParser, ParserInput } from './types.js';

/** One parser per bank layout. */
export const PARSERS: BankParser[] = [csobMojeInfo, airBankInfo, csasPayment];

export function pickParser(input: ParserInput): BankParser | null {
    const domain = input.domain.toLowerCase();
    return PARSERS.find((parser) =>
        parser.domains.some((d) => domain === d || domain.endsWith('.' + d)) && parser.matches(input),
    ) ?? null;
}
