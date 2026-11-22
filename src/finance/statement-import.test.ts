import { describe, expect, it } from 'vitest';
import type { Asset, Transaction } from '@hearthlog/sdk/data';
import { parseAirBankStatement } from './statements/airbank.js';
import { parseCsasStatement } from './statements/csas.js';
import type { Line } from './statements/pdf.js';
import { planFromParsed } from './statement-import.js';
import { transactionIdFor } from './bank-ids.js';
import type { ParsedStatement } from './statements/types.js';

/** Made-up statements (never a real one): what an import adds, and what it recognises as already there. */

const line = (y: number, ...cells: Array<[number, string]>): Line => ({ page: 1, y, cells: cells.map(([x, text]) => ({ x, text })) });

function airBankStatement() {
    return parseAirBankStatement([
        line(700, [60, 'Výpis z běžného účtu']),
        line(690, [60, 'Číslo účtu:'], [110, '1111111111 / 3030'], [258, 'Název účtu:'], [313, 'Hlavní']),
        line(680, [60, 'Období výpisu:'], [129, '1. 10. 2026 - 31. 10. 2026'], [258, 'Měna:'], [289, 'CZK']),
        line(670, [60, 'Počáteční zůstatek:'], [179, '1 000,00'], [258, 'Připsáno na účet:'], [347, '500,00']),
        line(660, [60, 'Konečný zůstatek:'], [179, '1 230,00'], [258, 'Odepsáno z účtu:'], [347, '270,00']),
        line(400, [60, 'Zaúčtování'], [106, 'Typ'], [184, 'Název']),
        line(390, [60, 'Provedení'], [106, 'Kód transakce'], [184, 'Číslo účtu / debetní karty'], [323, 'Detaily'], [483, 'Částka CZK'], [534, 'Poplatky']),
        line(370, [61, '01.10.2026'], [109, 'Obchodní úrok'], [187, 'Air Bank'], [496, '-20,00'], [549, '0,00']),
        line(358, [61, '01.10.2026'], [109, 'kontokorentu']),
        line(347, [109, '100000000001']),
        line(331, [61, '02.10.2026'], [109, 'Platba kartou'], [187, 'Someone'], [325, 'SHOP*1 MAIN'], [490, '-250,00'], [549, '0,00']),
        line(319, [61, '30.09.2026'], [109, '100000000002'], [187, '400000******0042'], [325, 'STREET,']),
        line(307, [325, 'CITY']),
        line(291, [61, '12.10.2026'], [109, 'Příchozí úhrada'], [187, 'PAYER'], [325, 'VS42 / SS7'], [488, '500,00'], [549, '0,00']),
        line(280, [61, '12.10.2026'], [109, '100000000003'], [187, '2222222222 / 0800']),
        line(82, [60, 'Pokračování na straně 2']),
    ]);
}

const ACCOUNT = 'CZ3930300000001111111111';
const linked = { id: 'air', name: 'Air Bank', amount: 1230, link: 'bank', account_hash: ACCOUNT } as unknown as Asset;

describe('Air Bank statement', () => {
    it('reads made-up rows across two and three lines and proves them against the totals', () => {
        const parsed = airBankStatement();
        expect(parsed.account).toBe('1111111111/3030');
        expect(parsed.rows.map((r) => [r.kind, r.counterpartyName, r.counterpartyAccount, r.amount, r.reference])).toEqual([
            ['Obchodní úrok kontokorentu', 'Air Bank', null, -20, '100000000001'],
            ['Platba kartou', 'Someone', '400000******0042', -250, '100000000002'],
            ['Příchozí úhrada', 'PAYER', '2222222222/0800', 500, '100000000003'],
        ]);
        expect(parsed.checks.every((check) => check.ok)).toBe(true);
    });

    it('names its rows the way the mails do, so a row a mail brought is already there', async () => {
        const fromMail = await transactionIdFor(ACCOUNT, 'airbank:100000000003');
        const plan = await planFromParsed(airBankStatement(), [linked], { ids: new Set([fromMail]), rows: [] });
        expect(plan.asset?.id).toBe('air');
        expect(plan.rows.map((entry) => [entry.row.reference, entry.status])).toEqual([
            ['100000000001', 'new'], ['100000000002', 'new'], ['100000000003', 'exists'],
        ]);
    });
});

describe('ČSOB statement', () => {
    // ČSOB's statement code is not in its mails: a mail row of the same day and amount is the same payment.
    const parsed: ParsedStatement = {
        parser: 'csob-statement-pdf@1', bank: 'ČSOB', account: '123456702/0300', iban: null, accountName: null,
        period: { from: '2026-10-01', to: '2026-10-31' }, currency: 'CZK', number: '2026/10', opening: 1000, closing: 700,
        credited: 0, debited: 300, overdraftLimit: null, checks: [], unplaced: [], warnings: [],
        rows: [
            { bank: 'ČSOB', account: '123456702/0300', bookingDate: '2026-10-05', executionDate: null, kind: 'Platba kartou', counterpartyName: 'SHOP', counterpartyAccount: null, details: null, variableSymbol: null, constantSymbol: null, specificSymbol: null, amount: -100, fee: 0, currency: 'CZK', reference: '5001', balanceAfter: 900 },
            { bank: 'ČSOB', account: '123456702/0300', bookingDate: '2026-10-05', executionDate: null, kind: 'Platba kartou', counterpartyName: 'SHOP', counterpartyAccount: null, details: null, variableSymbol: null, constantSymbol: null, specificSymbol: null, amount: -100, fee: 0, currency: 'CZK', reference: '5002', balanceAfter: 800 },
            { bank: 'ČSOB', account: '123456702/0300', bookingDate: '2026-10-09', executionDate: null, kind: 'Odchozí úhrada', counterpartyName: 'RENT', counterpartyAccount: null, details: null, variableSymbol: null, constantSymbol: null, specificSymbol: null, amount: -100, fee: 0, currency: 'CZK', reference: '5003', balanceAfter: 700 },
        ],
    };
    const csob = { id: 'csob', name: 'ČSOB', amount: 700, link: 'bank', account_hash: 'CZ8303000000000123456702' } as unknown as Asset;

    it('matches each mail row once by day and amount and adds the rest', async () => {
        const mailRow = { id: 'm1', due_date: '2026-10-05', amount: -100, bank_ref: 'mail:<a@x>' } as unknown as Transaction;
        const plan = await planFromParsed(parsed, [csob], { ids: new Set(), rows: [mailRow] });
        expect(plan.rows.map((entry) => entry.status)).toEqual(['matched', 'new', 'new']);
        expect(plan.rows[0]!.bankRef).toBe('csob-statement:5001');
    });

    it('says when the account is not linked yet', async () => {
        const plan = await planFromParsed(parsed, [], { ids: new Set(), rows: [] });
        expect(plan.asset).toBeNull();
        expect(plan.accountDisplay).toBe('123456702/0300');
    });
});

describe('Česká spořitelna statement', () => {
    // Laid out like George's statement: a row's first line has the booking date, item, counterparty, VS and amount;
    // under it the execution date, constant and specific symbols and the description.
    const statement = () => parseCsasStatement([
        line(810, [173, 'Výpis z účtu']),
        line(798, [173, 'Standard účet České spořitelny'], [415, 'Období: 01.10.2026 - 31.10.2026']),
        line(786, [173, 'Číslo účtu/kód banky: 1111111111/0800'], [485, 'Číslo výpisu: 010']),
        line(740, [43, 'Měna účtu: CZK']),
        line(707, [43, 'Číslo účtu (IBAN): CZ14 0800 0000 0011 1111 1111']),
        line(569, [43, 'Počáteční zůstatek:'], [231, '1 000.00']),
        line(559, [43, 'Celkem přišlo:'], [210, '600.00']),
        line(550, [43, 'Celkem odešlo:'], [213, '-350.10']),
        line(540, [43, 'Konečný zůstatek:'], [214, '1 249.90']),
        line(516, [48, 'PŘEHLED POHYBŮ NA ÚČTU'], [244, 'Počáteční zůstatek:'], [528, '1 000.00']),
        line(503, [48, 'Zaúčtováno'], [99, 'Položka'], [244, 'Číslo protiúčtu'], [398, 'Variabilní symbol'], [522, 'Částka']),
        line(493, [48, 'Provedeno'], [244, 'Název protiúčtu'], [398, 'Konstantní symbol']),
        line(474, [99, 'Popis']),
        line(459, [48, '03.10.2026'], [99, 'Tuzemská odchozí úhrada'], [244, '2222222222/0800'], [398, '1234'], [519, '-350.00']),
        line(450, [398, '0308']),
        line(437, [99, 'OBJEDNAVKA 1234 NA EXAMPLE.CZ']),
        line(425, [48, '04.10.2026'], [99, 'Převod kartou'], [516, '+600.00']),
        line(416, [398, '0308']),
        line(414, [48, '03.10.2026']),
        line(405, [398, '9999']),
        line(392, [99, 'XXXXXXXXXXXX0042 d.tran.03.10.2026'], [326, 'SOMEONE']),
        line(370, [48, '08.10.2026'], [99, 'Úrok z prodlení'], [528, '-0.10']),
        line(360, [48, '07.10.2026']),
        line(48, [462, 'Pokračování na další straně']),
        { page: 2, y: 749, cells: [[48, 'Zaúčtováno'], [99, 'Položka'], [244, 'Číslo protiúčtu'], [398, 'Variabilní symbol'], [522, 'Částka']].map(([x, text]) => ({ x: x as number, text: text as string })) },
        { page: 2, y: 658, cells: [{ x: 48, text: '31.10.2026' }, { x: 99, text: 'Ceny za služby' }] },
        { page: 2, y: 646, cells: [{ x: 99, text: 'Cena za vedení účtu' }, { x: 530, text: '0.00' }] },
        { page: 2, y: 632, cells: [{ x: 244, text: 'Konečný zůstatek:' }, { x: 509, text: '1 249.90' }] },
        { page: 2, y: 604, cells: [{ x: 48, text: 'NEPROVEDENÉ POLOŽKY' }] },
        { page: 2, y: 556, cells: [{ x: 48, text: '29.10.2026' }, { x: 99, text: 'Vyřazení čekající platby' }, { x: 512, text: '-1 500.00' }] },
        { page: 2, y: 35, cells: [{ x: 42, text: 'Česká spořitelna, a.s., Praha 4' }] },
    ]);

    it('reads rows over several lines, leaves out payments not made, and proves them against the totals', () => {
        const parsed = statement();
        expect(parsed.iban).toBe('CZ1408000000001111111111');
        expect(parsed.rows.map((r) => [r.bookingDate, r.executionDate, r.kind, r.counterpartyName, r.counterpartyAccount, r.variableSymbol, r.constantSymbol, r.specificSymbol, r.amount])).toEqual([
            ['2026-10-03', null, 'Tuzemská odchozí úhrada', null, '2222222222/0800', '1234', '0308', null, -350],
            ['2026-10-04', '2026-10-03', 'Převod kartou', 'SOMEONE', null, null, '0308', '9999', 600],
            ['2026-10-08', '2026-10-07', 'Úrok z prodlení', null, null, null, null, null, -0.1],
            ['2026-10-31', null, 'Ceny za služby', null, null, null, null, null, 0],
        ]);
        expect(parsed.rows[0]!.details).toBe('OBJEDNAVKA 1234 NA EXAMPLE.CZ');
        expect(parsed.checks.every((check) => check.ok)).toBe(true);
        expect(parsed.checks.some((check) => check.label.includes('reference'))).toBe(false);
    });

    it('finds a mail row on the execution date when booking came a day later', async () => {
        const linked = { id: 'cs', name: 'Spořitelna', amount: 1249.9, link: 'bank', account_hash: 'CZ1408000000001111111111' } as unknown as Asset;
        const mailRow = { id: 'm1', due_date: '2026-10-03', amount: 600, bank_ref: 'mail:<a@x>' } as unknown as Transaction;
        const plan = await planFromParsed(statement(), [linked], { ids: new Set(), rows: [mailRow] });
        expect(plan.rows.map((entry) => entry.status)).toEqual(['new', 'matched', 'new', 'new']);
    });
});
