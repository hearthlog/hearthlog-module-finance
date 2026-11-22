/**
 * Česká spořitelna payment notices ("Přišla platba" / "Odešla platba", sent from George). Written from one incoming
 * and one outgoing transfer (22 Nov 2026). The mail carries no transaction code, so its row is matched to the
 * statement by day and amount; card payments will show up as unmapped lines until one is seen.
 */

import { normalizeLabel, parseAmount, parseCzDate } from './html.js';
import { emptyParsed, type BankParser } from './types.js';

/** "100,00 Kč" → 100 and CZK. */
function money(text: string): { amount: number; currency: string | null } | null {
    return parseAmount(text.replace(/\s*Kč\s*\.?$/, ' CZK').replace(/\.$/, ''));
}

type Field = 'account' | 'counterpartyAccount' | 'counterpartyName' | 'variableSymbol' | 'constantSymbol' | 'specificSymbol' | 'message';

const LABELS: Record<string, Field | 'date' | 'direction' | 'amount' | 'sent'> = {
    'datum a cas platby': 'date',
    'smer platby': 'direction',
    'cislo uctu': 'account',
    'z uctu': 'account',
    'cislo uctu protistrany': 'counterpartyAccount',
    'na ucet': 'counterpartyAccount',
    'nazev protistrany': 'counterpartyName',
    'castka v mene transakce': 'sent',
    'castka v mene uctu': 'amount',
    'variabilni symbol': 'variableSymbol',
    'konstantni symbol': 'constantSymbol',
    'specificky symbol': 'specificSymbol',
    'zprava pro prijemce': 'message',
};

export const csasPayment: BankParser = {
    id: 'csas-payment',
    version: 1,
    bank: 'Česká spořitelna',
    domains: ['csas.cz'],

    matches(input) {
        return /^(Přišla|Odešla) platba/i.test(input.subject) || /Informace o transakci/.test(input.text);
    },

    parse(input) {
        const out = emptyParsed(this);
        const text = input.text.replace(/[​-‍﻿]/g, '').replace(/[ \t  ]+/g, ' ');

        const head = text.match(/(na účet|z účtu) (\S+) (?:právě )?(dorazila|odešla) platba ve výši ([\d  .,]+ ?(?:Kč|[A-Z]{3}))/);
        let sign = 0;
        if (head) {
            sign = head[3] === 'odešla' ? -1 : 1;
            out.account = head[2];
            const stated = money(head[4]);
            if (stated) {
                out.amount = sign * Math.abs(stated.amount);
                out.currency = stated.currency;
            }
            out.kind = sign < 0 ? 'Odchozí platba' : 'Příchozí platba';
            out.fields.push({ field: 'Amount', value: `${sign < 0 ? '−' : '+'}${head[4]}`, from: `opening sentence: "${head[3]}"` });
        } else {
            out.warnings.push('The opening sentence ("na účet … dorazila / z účtu … odešla platba ve výši …") was not found.');
        }

        const balance = text.match(/k dispozici (-?[\d  .,]+ ?(?:Kč|[A-Z]{3}))/);
        if (balance) {
            const stated = money(balance[1]);
            out.balanceAfter = stated?.amount ?? null;
            out.balanceCurrency = stated?.currency ?? null;
            out.balanceKind = 'available';
            out.fields.push({ field: 'Balance after', value: balance[1], from: 'available balance' });
        } else {
            out.warnings.push('No available balance in this email.');
        }

        const block = text.split(/Informace o transakci/)[1]?.split(/Bezpečí Vašich peněz|Jsme tu pro Vás/)[0] ?? '';
        for (const line of block.split('\n').map((l) => l.trim()).filter(Boolean)) {
            const pair = line.match(/^([^:]{2,40}): ?(.*)$/);
            if (!pair) {
                out.unmapped.push({ label: 'Line', value: line });
                continue;
            }
            const value = pair[2].trim();
            const target = LABELS[normalizeLabel(pair[1])];
            switch (target) {
                case undefined:
                    out.unmapped.push({ label: pair[1], value });
                    break;
                case 'date': {
                    out.bookingDate = parseCzDate(value);
                    const time = value.match(/(\d{1,2}):(\d{2})/);
                    if (out.bookingDate) out.balanceAt = `${out.bookingDate}T${time ? `${time[1].padStart(2, '0')}:${time[2]}` : '00:00'}`;
                    out.fields.push({ field: 'Payment date', value, from: pair[1] });
                    break;
                }
                case 'direction':
                    out.state = value;
                    if (!sign) sign = /odchoz/i.test(value) ? -1 : /příchoz/i.test(value) ? 1 : 0;
                    out.fields.push({ field: 'Direction', value, from: pair[1] });
                    break;
                case 'amount': {
                    const stated = money(value);
                    if (stated && out.amount === null && sign) {
                        out.amount = sign * Math.abs(stated.amount);
                        out.currency = stated.currency;
                    } else if (stated && out.amount !== null && Math.abs(Math.abs(stated.amount) - Math.abs(out.amount)) > 0.005) {
                        out.warnings.push(`The amount in the account's currency (${value}) differs from the opening sentence.`);
                    }
                    break;
                }
                case 'sent':
                    if (!/Kč$/.test(value)) out.sentAmount = value;
                    break;
                default:
                    if (target === 'account' && out.account && out.account !== value) out.warnings.push(`Two accounts named: ${out.account} and ${value}.`);
                    out[target] = value;
                    out.fields.push({ field: target, value, from: pair[1] });
            }
        }

        // A notice describes a payment that has just happened; the bank does not say booked or not.
        if (out.currency && out.currency !== 'CZK') out.warnings.push(`Amount is in ${out.currency}; conversion is not handled yet.`);
        return out;
    },
};
