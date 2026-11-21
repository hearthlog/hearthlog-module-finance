/** Enable Banking responses read the way Finance reads them: the balance to show and each booked row. */

export interface EbAmount {
    currency?: string;
    amount?: string;
}

export interface EbBalance {
    name?: string;
    balance_amount?: EbAmount;
    balance_type?: string;
    reference_date?: string | null;
    last_change_date_time?: string | null;
}

export interface EbTransaction {
    entry_reference?: string | null;
    transaction_id?: string | null;
    transaction_amount?: EbAmount;
    credit_debit_indicator?: 'CRDT' | 'DBIT' | string;
    status?: string;
    booking_date?: string | null;
    value_date?: string | null;
    transaction_date?: string | null;
    creditor?: { name?: string | null } | null;
    debtor?: { name?: string | null } | null;
    creditor_account?: Record<string, unknown> | null;
    debtor_account?: Record<string, unknown> | null;
    remittance_information?: string[] | null;
    bank_transaction_code?: { description?: string | null; code?: string | null } | null;
    merchant_category_code?: string | null;
    balance_after_transaction?: EbAmount | null;
    note?: string | null;
}

/** Most current first: what is spendable now beats yesterday's closing figure. */
const BALANCE_PREFERENCE = ['ITAV', 'XPCD', 'CLAV', 'ITBD', 'CLBD', 'OPAV', 'OPBD', 'FWAV', 'INFO', 'VALU', 'PRCD', 'OTHR'];

export function chooseBalance(balances: EbBalance[]) {
    const all = balances.map((b) => ({
        type: b.balance_type ?? '?',
        name: b.name ?? null,
        amount: Number(b.balance_amount?.amount),
        currency: b.balance_amount?.currency ?? null,
        referenceDate: b.reference_date ?? b.last_change_date_time ?? null,
    }));
    const ranked = [...all].sort((a, b) => rank(a.type) - rank(b.type));
    return { chosen: ranked[0] ?? null, all };
}

function rank(type: string): number {
    const at = BALANCE_PREFERENCE.indexOf(type);
    return at === -1 ? BALANCE_PREFERENCE.length : at;
}

export interface FinanceRow {
    date: string | null;
    name: string;
    amount: number;
    currency: string | null;
    status: string;
    booked: boolean;
    bank_ref: string | null;
    counterparty: string | null;
    bank_text: string | null;
    mcc: string | null;
    note: string | null;
}

export function toFinanceRow(t: EbTransaction): FinanceRow {
    const raw = Number(t.transaction_amount?.amount);
    const outgoing = t.credit_debit_indicator === 'DBIT';
    const amount = outgoing ? -Math.abs(raw) : Math.abs(raw);
    const counterparty = (outgoing ? t.creditor?.name : t.debtor?.name) ?? null;
    const text = (t.remittance_information ?? []).filter(Boolean).join(' ').trim() || null;
    const booked = t.status === 'BOOK';
    return {
        date: t.booking_date ?? t.value_date ?? t.transaction_date ?? null,
        name: counterparty ?? text ?? t.bank_transaction_code?.description ?? 'Revolut payment',
        amount,
        currency: t.transaction_amount?.currency ?? null,
        status: t.status ?? '?',
        booked,
        // The bank's own reference; a booked row without one falls back to its transaction id.
        bank_ref: booked ? (t.entry_reference || t.transaction_id || null) : null,
        counterparty,
        bank_text: text,
        mcc: t.merchant_category_code ?? null,
        note: null,
    };
}
