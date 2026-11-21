/**
 * Trial parser for Air Bank "Info o dění na účtu" emails (plain text).
 * Written from one incoming and one outgoing payment (13 Nov 2026); card
 * payments will show up as unmapped lines until they are added.
 */

import { normalizeLabel, parseAmount, parseCzDate } from './html.js';
import { emptyParsed, type BankParser } from './types.js';

const MONEY = '([+\\-−]?[\\d .,]+?) ([A-Z]{3})';

export const airBankInfo: BankParser = {
    id: 'airbank-info',
    version: 1,
    bank: 'Air Bank',
    domains: ['airbank.cz'],

    matches(input) {
        return /zůstatku na účtu/i.test(input.subject) || /zůstatek na účtu .+ se (snížil|zvýšil)/.test(input.text);
    },

    parse(input) {
        const out = emptyParsed(this);
        const text = input.text.replace(/[​-‍﻿]/g, '').replace(/[ \t  ]+/g, ' ');

        const head = text.match(new RegExp(`zůstatek na účtu (.+?) číslo (\\S+) se (snížil|zvýšil) o částku ${MONEY}\\.`));
        if (head) {
            const parsed = parseAmount(head[4]);
            out.account = head[2];
            out.amount = parsed ? (head[3] === 'snížil' ? -1 : 1) * Math.abs(parsed.amount) : null;
            out.currency = head[5];
            out.fields.push({ field: 'Account name', value: head[1], from: 'opening sentence' });
            out.fields.push({ field: 'Account', value: head[2], from: 'opening sentence' });
            out.fields.push({ field: 'Amount', value: `${head[3] === 'snížil' ? '−' : '+'}${head[4]} ${head[5]}`, from: `opening sentence: "se ${head[3]}"` });
        } else {
            out.warnings.push('The opening sentence ("zůstatek na účtu … se snížil/zvýšil o částku …") was not found.');
        }

        const balance = text.match(new RegExp(`Dostupný zůstatek k (\\d{1,2}\\.\\d{1,2}\\.\\d{4}) v (\\d{1,2}:\\d{2}) je ${MONEY}\\.`));
        if (balance) {
            out.balanceAfter = parseAmount(balance[3])?.amount ?? null;
            out.balanceCurrency = balance[4];
            out.balanceKind = 'available';
            out.balanceAt = `${parseCzDate(balance[1])}T${balance[2].padStart(5, '0')}`;
            out.fields.push({ field: 'Balance after', value: `${balance[3]} ${balance[4]}`, from: `available balance at ${balance[1]} ${balance[2]}` });
        } else {
            out.warnings.push('No available balance in this email.');
        }
        const credit = text.match(new RegExp(`Dostupný zůstatek včetně kontokorentu je ${MONEY}\\.`));
        if (credit) out.fields.push({ field: 'Available incl. overdraft', value: `${credit[1]} ${credit[2]}`, from: 'shown only, not counted' });

        const detail = text.match(/(Příchozí|Odchozí) (úhrada|platba) (z účtu|na účet) ?(.*?) ?číslo (\S+)/);
        if (detail) {
            out.kind = `${detail[1]} ${detail[2]}`;
            out.counterpartyName = detail[4].trim() || null;
            out.counterpartyAccount = detail[5];
            out.fields.push({ field: 'Kind', value: out.kind, from: 'detail line' });
            if (out.counterpartyName) out.fields.push({ field: 'Counterparty name', value: out.counterpartyName, from: 'detail line' });
            out.fields.push({ field: 'Counterparty account', value: detail[5], from: 'detail line' });
        }

        const block = text.split(/Pro úplnost uvádíme detaily[^:\n]*:/)[1]?.split(/Nechceme, aby Vás/)[0] ?? '';
        for (const line of block.split('\n').map((l) => l.trim()).filter(Boolean)) {
            const pair = line.match(/^([^:]{2,40}): ?(.+)$/);
            if (!pair) {
                if (!detail || !line.includes(detail[5])) out.unmapped.push({ label: 'Line', value: line });
                continue;
            }
            const value = pair[2].trim();
            switch (normalizeLabel(pair[1])) {
                case 'castka': {
                    const stated = parseAmount(value);
                    if (stated && out.amount !== null && Math.abs(Math.abs(stated.amount) - Math.abs(out.amount)) > 0.005) {
                        out.warnings.push(`The detail amount ${value} differs from the opening sentence.`);
                    }
                    break;
                }
                case 'datum zauctovani':
                    out.bookingDate = parseCzDate(value);
                    out.booked = true;
                    out.state = `zaúčtováno ${value}`;
                    out.fields.push({ field: 'Booking date', value, from: pair[1] });
                    break;
                case 'kod transakce':
                    out.reference = value;
                    out.fields.push({ field: 'Transaction code', value, from: pair[1] });
                    break;
                default:
                    out.unmapped.push({ label: pair[1], value });
            }
        }

        if (out.booked === null) out.warnings.push('No booking date: the payment may not be booked yet.');
        if (!out.bookingDate && out.balanceAt) out.bookingDate = out.balanceAt.slice(0, 10);
        if (out.currency && out.currency !== 'CZK') out.warnings.push(`Amount is in ${out.currency}; conversion is not handled yet.`);
        return out;
    },
};
