import { airBankInfo } from './airbank.js';
import { csobMojeInfo } from './csob.js';
import type { BankParser, ParserInput } from './types.js';

/** First implementation: ČSOB and Air Bank. More banks later, one parser each. */
export const PARSERS: BankParser[] = [csobMojeInfo, airBankInfo];

export function pickParser(input: ParserInput): BankParser | null {
    const domain = input.domain.toLowerCase();
    return PARSERS.find((parser) =>
        parser.domains.some((d) => domain === d || domain.endsWith('.' + d)) && parser.matches(input),
    ) ?? null;
}
