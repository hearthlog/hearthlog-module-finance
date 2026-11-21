export interface ParserInput {
    subject: string;
    from: string;
    /** Signed domain when the signature passed, otherwise the From domain. */
    domain: string;
    html: string;
    text: string;
    rows: Array<{ label: string; value: string }>;
}

export interface ParsedEmail {
    /** `<id>@<version>` of the parser that read it. */
    parser: string;
    bank: string;
    /** The bank's word for the state, e.g. "zaúčtována". */
    state: string | null;
    /** True when the bank says the payment is booked; null when it does not say. */
    booked: boolean | null;
    kind: string | null;
    account: string | null;
    counterpartyAccount: string | null;
    counterpartyName: string | null;
    bookingDate: string | null;
    amount: number | null;
    currency: string | null;
    balanceAfter: number | null;
    balanceCurrency: string | null;
    /** What the stated balance is: after booking (ČSOB) or available (Air Bank). */
    balanceKind: string | null;
    /** When the bank says the balance applied, if it says. */
    balanceAt: string | null;
    /** The bank's own id for the transaction, when the email carries one. */
    reference: string | null;
    variableSymbol: string | null;
    constantSymbol: string | null;
    specificSymbol: string | null;
    message: string | null;
    sentAmount: string | null;
    exchangeRate: string | null;
    /** What was read, in reading order, with the bank's own label. */
    fields: Array<{ field: string; value: string; from: string }>;
    /** Rows the parser does not know yet: these drive parser work. */
    unmapped: Array<{ label: string; value: string }>;
    warnings: string[];
}

export interface BankParser {
    id: string;
    version: number;
    bank: string;
    domains: string[];
    matches(input: ParserInput): boolean;
    parse(input: ParserInput): ParsedEmail;
}

export function emptyParsed(parser: BankParser): ParsedEmail {
    return {
        parser: `${parser.id}@${parser.version}`,
        bank: parser.bank,
        state: null,
        booked: null,
        kind: null,
        account: null,
        counterpartyAccount: null,
        counterpartyName: null,
        bookingDate: null,
        amount: null,
        currency: null,
        balanceAfter: null,
        balanceCurrency: null,
        balanceKind: null,
        balanceAt: null,
        reference: null,
        variableSymbol: null,
        constantSymbol: null,
        specificSymbol: null,
        message: null,
        sentAmount: null,
        exchangeRate: null,
        fields: [],
        unmapped: [],
        warnings: [],
    };
}
