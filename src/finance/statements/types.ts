/** A statement row has the same core shape as a row read from an email, so everything after parsing is shared. */
export interface StatementRow {
    bank: string;
    account: string;
    bookingDate: string | null;
    executionDate: string | null;
    kind: string;
    counterpartyName: string | null;
    counterpartyAccount: string | null;
    details: string | null;
    variableSymbol: string | null;
    constantSymbol: string | null;
    specificSymbol: string | null;
    amount: number;
    fee: number;
    currency: string;
    /** The bank's transaction code; the same one its notification emails carry. */
    reference: string | null;
    /** Running balance from the opening balance, in statement order. */
    balanceAfter: number;
}

export interface StatementCheck {
    label: string;
    ok: boolean;
    detail: string;
}

export interface ParsedStatement {
    parser: string;
    bank: string;
    account: string | null;
    iban: string | null;
    accountName: string | null;
    period: { from: string | null; to: string | null };
    currency: string;
    number: string | null;
    opening: number | null;
    closing: number | null;
    credited: number | null;
    debited: number | null;
    overdraftLimit: number | null;
    rows: StatementRow[];
    /** Proof that nothing was missed: the bank's own totals against the rows read. */
    checks: StatementCheck[];
    /** Lines inside the transaction table that no rule placed; should stay empty. */
    unplaced: string[];
    warnings: string[];
}
