/**
 * Trial parser for ČSOB "Moje info - Avízo" emails. Written from one incoming
 * payment (12 Nov 2026); card, outgoing and fee emails will show up as
 * unmapped rows or warnings until they are added.
 */

import { normalizeLabel, parseAmount, parseCzDate } from './html.js';
import { emptyParsed, type BankParser, type ParsedEmail } from './types.js';

type TextField = 'account' | 'counterpartyAccount' | 'counterpartyName' | 'variableSymbol' | 'constantSymbol'
    | 'specificSymbol' | 'message' | 'sentAmount' | 'exchangeRate';

const LABELS: Record<string, TextField | 'bookingDate' | 'amount'> = {
    'ucet': 'account',
    'ucet protistrany': 'counterpartyAccount',
    'nazev protistrany': 'counterpartyName',
    'datum uctovani': 'bookingDate',
    'castka': 'amount',
    'zaslana castka platby': 'sentAmount',
    'kurz': 'exchangeRate',
    'variabilni symbol': 'variableSymbol',
    'konstantni symbol': 'constantSymbol',
    'specificky symbol': 'specificSymbol',
    'zprava pro prijemce': 'message',
};

const NAMES: Record<string, string> = {
    account: 'Account',
    counterpartyAccount: 'Counterparty account',
    counterpartyName: 'Counterparty name',
    bookingDate: 'Booking date',
    amount: 'Amount',
    sentAmount: 'Amount sent',
    exchangeRate: 'Exchange rate',
    variableSymbol: 'Variable symbol',
    constantSymbol: 'Constant symbol',
    specificSymbol: 'Specific symbol',
    message: 'Message',
};

export const csobMojeInfo: BankParser = {
    id: 'csob-moje-info',
    version: 1,
    bank: 'ČSOB',
    domains: ['csob.cz'],

    matches(input) {
        return /Moje info/i.test(input.subject) || input.html.includes('Parametry platby');
    },

    parse(input) {
        const out: ParsedEmail = emptyParsed(this);

        const intro = input.text.match(/dne (\d{1,2}\.\d{1,2}\.\d{4}) byla na účtu (\S+) (\S+) transakce typu: ([^.\n]+)\./);
        if (intro) {
            out.state = intro[3];
            out.booked = /^zaúčtov/i.test(intro[3]);
            out.kind = intro[4].trim();
            out.fields.push({ field: 'State', value: intro[3], from: 'opening sentence' });
            out.fields.push({ field: 'Kind', value: out.kind, from: 'opening sentence' });
        } else {
            out.warnings.push('The opening sentence ("dne … byla na účtu … transakce typu: …") was not found.');
        }

        for (const row of input.rows) {
            const key = LABELS[normalizeLabel(row.label)];
            if (!key) {
                out.unmapped.push(row);
                continue;
            }
            if (key === 'amount') {
                const parsed = parseAmount(row.value);
                if (parsed) {
                    out.amount = parsed.amount;
                    out.currency = parsed.currency;
                } else {
                    out.warnings.push(`Amount "${row.value}" could not be read as a number.`);
                }
            } else if (key === 'bookingDate') {
                out.bookingDate = parseCzDate(row.value);
                if (!out.bookingDate) out.warnings.push(`Booking date "${row.value}" could not be read.`);
            } else {
                out[key] = row.value;
            }
            out.fields.push({ field: NAMES[key], value: row.value, from: row.label });
        }

        const balance = input.text.match(/Zůstatek na účtu po zaúčtování transakce:\s*([+\-−]?[\d\s.,]+?)\s*([A-Z]{3})/);
        if (balance) {
            const parsed = parseAmount(balance[1] + balance[2]);
            out.balanceAfter = parsed?.amount ?? null;
            out.balanceCurrency = parsed?.currency ?? null;
            out.balanceKind = 'after booking';
            out.fields.push({ field: 'Balance after', value: `${balance[1].trim()} ${balance[2]}`, from: 'closing sentence' });
        } else {
            out.warnings.push('No balance after the transaction in this email.');
        }

        if (!out.bookingDate && intro) out.bookingDate = parseCzDate(intro[1]);
        if (!out.account && intro) out.account = intro[2];
        if (out.amount === null) out.warnings.push('No amount found.');
        if (!out.account) out.warnings.push('No account number found.');
        if (out.currency && out.currency !== 'CZK') out.warnings.push(`Amount is in ${out.currency}; conversion is not handled yet.`);
        return out;
    },
};
