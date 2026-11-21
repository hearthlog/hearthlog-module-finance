import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { ServerIntegration, ServiceAppend } from '@hearthlog/sdk/server';
import { handleBankMail } from './bank-email.js';
import { memoryBankState } from './bank-state.js';
import type { DkimSummary } from './mail/dkim.js';
import { assetIdFor, transactionIdFor } from '../finance/bank-ids.js';

/**
 * One fixture per bank layout, made up (never a real mail): the handler turns each into the account, its balance and
 * the row, once, and sets aside what it must not trust. The signature check is stubbed here; it was proven against the
 * banks' real mails in the proof of concept.
 */

const NOW = Date.UTC(2026, 10, 21, 10, 0);
const fixture = (name: string) => readFileSync(new URL(`../../test-fixtures/${name}`, import.meta.url), 'utf8');
const bytes = (text: string) => new TextEncoder().encode(text);

/** A signature check that passes for the given domain, aligned with From. */
const signedBy = (domain: string | null) => async (): Promise<DkimSummary> => domain
    ? { status: 'pass', fromDomain: domain, checks: [], best: { status: 'pass', domain, selector: 's', algorithm: 'rsa-sha256', canonicalization: 'relaxed/relaxed', signedHeaders: [], bodyHash: 'match', alignedWithFrom: true, expired: false, reason: '' } }
    : { status: 'none', fromDomain: 'csob.cz', checks: [], best: null };

interface Stored { type: string; payload: Record<string, unknown> }

/** Enough of Ledger for one integration: versions per entity, the events as appended, idempotent request ids. */
function fakeLedger() {
    const versions = new Map<string, number>();
    const requests = new Set<string>();
    const events = new Map<string, Stored[]>();
    const integration: ServerIntegration = {
        id: 'bank-mail',
        kind: 'bank-email',
        logId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
        async upsertEntity(build) {
            let append: ServiceAppend = await build(undefined);
            const entityId = append.events[0]!.entityId;
            const live = versions.get(entityId);
            if (live !== undefined) append = await build(live);
            if (requests.has(append.requestId)) return live === undefined ? 'created' : 'updated';
            requests.add(append.requestId);
            versions.set(entityId, (live ?? 0) + 1);
            events.set(entityId, [...(events.get(entityId) ?? []), ...append.events.map((e) => ({ type: e.type, payload: e.payload }))]);
            return live === undefined ? 'created' : 'updated';
        },
    };
    /** The entity as the browser would project it: added payload with every update merged in. */
    const state = (entityId: string) => Object.assign({}, ...(events.get(entityId) ?? []).map((e) => e.payload)) as Record<string, unknown>;
    return { integration, events, state };
}

function run(ledger: ReturnType<typeof fakeLedger>, store: ReturnType<typeof memoryBankState>, raw: string, domain: string | null) {
    const rejected: string[] = [];
    return handleBankMail({
        integration: ledger.integration,
        raw: bytes(raw),
        now: NOW,
        store,
        mailDomain: 'in.example.test',
        reject: (reason) => rejected.push(reason),
        read: { verify: signedBy(domain) },
    });
}

/** The same ČSOB layout with another message id, amount and stated balance. */
function csobVariant(id: string, amountQp: string, balanceQp: string): string {
    return fixture('csob-payment.eml')
        .replace('<synthetic-1@example.invalid>', `<${id}@example.invalid>`)
        .replace('-1=C2=A0250,50 CZK', amountQp)
        .replace('+2=C2=A0749,50 CZK', balanceQp);
}

describe('ČSOB notification', () => {
    it('becomes the connection, the account with its balance, and one unreviewed row', async () => {
        const ledger = fakeLedger();
        const outcome = await run(ledger, memoryBankState(), fixture('csob-payment.eml'), 'csob.cz');
        const account = 'CZ8303000000000123456702';
        const assetId = await assetIdFor('bank-mail', account);
        expect(outcome).toMatchObject({ kind: 'payment', assetId, gap: 0 });

        const asset = ledger.state(`asset:${assetId}`);
        expect(asset).toMatchObject({
            name: 'ČSOB ••6702', amount: 2749.5, link: 'bank', provider: 'email', account_hash: account,
            account_kind: 'current', balance_source: 'bank', asset_type: 'asset',
        });
        const connection = ledger.state(`bank_connection:${asset.connection_id}`);
        expect(connection).toMatchObject({ bank: 'csob', provider: 'email', status: 'active', address: 'bank-mail@in.example.test', rows_since: '2026-11-13' });

        // ČSOB mails carry no transaction code, so the row is named by the message.
        const transactionId = await transactionIdFor(account, 'mail:<synthetic-1@example.invalid>');
        expect(outcome.kind === 'payment' && outcome.transactionId).toBe(transactionId);
        expect(ledger.state(`transaction:${transactionId}`)).toMatchObject({
            name: 'Example s.r.o.', amount: -1250.5, due_date: '2026-11-13', transaction_status: 'archived',
            transaction_category: 'unknown', review: 'new', asset_id: assetId, counterparty: 'Example s.r.o. · 123456710/0800',
        });
    });

    it('takes a mail delivered twice once', async () => {
        const ledger = fakeLedger();
        const store = memoryBankState();
        await run(ledger, store, fixture('csob-payment.eml'), 'csob.cz');
        expect(await run(ledger, store, fixture('csob-payment.eml'), 'csob.cz')).toEqual({ kind: 'duplicate' });
        expect([...ledger.events.keys()].filter((key) => key.startsWith('transaction:'))).toHaveLength(1);
    });

    it('follows the balance from mail to mail and puts a gap on the account when one went missing', async () => {
        const ledger = fakeLedger();
        const store = memoryBankState();
        await run(ledger, store, fixture('csob-payment.eml'), 'csob.cz'); // 2 749,50
        // −249,50 → 2 500,00: follows.
        const next = await run(ledger, store, csobVariant('second', '-249,50 CZK', '+2=C2=A0500,00 CZK'), 'csob.cz');
        expect(next).toMatchObject({ kind: 'payment', gap: 0 });
        // −100,00 but the bank says 2 160,00: 240 went without a mail.
        const gap = await run(ledger, store, csobVariant('third', '-100,00 CZK', '+2=C2=A0160,00 CZK'), 'csob.cz');
        expect(gap).toMatchObject({ kind: 'payment', gap: -240 });
        const asset = ledger.state(`asset:${gap.kind === 'payment' ? gap.assetId : ''}`);
        expect(asset).toMatchObject({ amount: 2160, sync_issue: 'balance_gap', issue_amount: -240 });
    });

    it('does not trust a mail the bank did not sign, nor an account number that fails its checksum', async () => {
        const ledger = fakeLedger();
        const unsigned = await run(ledger, memoryBankState(), fixture('csob-payment.eml'), null);
        expect(unsigned).toMatchObject({ kind: 'set-aside', reason: 'Not signed by ČSOB, so it was not trusted' });
        const mail = ledger.state(`bank_mail:${unsigned.kind === 'set-aside' ? unsigned.mailId : ''}`);
        expect(mail).toMatchObject({ mail_kind: 'unread', status: 'open', bank: 'csob', subject: 'Moje info - Avízo' });
        expect(String(mail.body_text)).toContain('Example s.r.o.');

        const misread = await run(fakeLedger(), memoryBankState(), fixture('csob-bad-checksum.eml'), 'csob.cz');
        expect(misread).toMatchObject({ kind: 'set-aside', reason: 'The account number in the message did not pass its checksum' });
    });
});

describe('Air Bank notification', () => {
    it('becomes a row named by the bank’s transaction code, with the available balance', async () => {
        const ledger = fakeLedger();
        const outcome = await run(ledger, memoryBankState(), fixture('airbank-payment.eml'), 'airbank.cz');
        expect(outcome.kind).toBe('payment');
        if (outcome.kind !== 'payment') return;
        const account = 'CZ3930300000001111111111';
        expect(outcome.transactionId).toBe(await transactionIdFor(account, 'airbank:100000000001'));
        expect(ledger.state(`asset:${outcome.assetId}`)).toMatchObject({ name: 'Air Bank ••1111', amount: -2236.83, account_hash: account });
        expect(ledger.state(`transaction:${outcome.transactionId}`)).toMatchObject({ amount: -1012, due_date: '2026-11-13', bank_ref: 'airbank:100000000001' });
    });
});

describe('forwarding confirmation', () => {
    it('keeps the mailbox’s confirmation code for the linking step', async () => {
        const ledger = fakeLedger();
        const outcome = await run(ledger, memoryBankState(), fixture('gmail-confirmation.eml'), 'google.com');
        expect(outcome.kind).toBe('set-aside');
        const mail = ledger.state(`bank_mail:${outcome.kind === 'set-aside' ? outcome.mailId : ''}`);
        expect(mail).toMatchObject({ mail_kind: 'confirmation', code: '123456789', status: 'open' });
    });

    it('does not show a code from an unsigned look-alike', async () => {
        const ledger = fakeLedger();
        const outcome = await run(ledger, memoryBankState(), fixture('gmail-confirmation.eml'), null);
        const mail = ledger.state(`bank_mail:${outcome.kind === 'set-aside' ? outcome.mailId : ''}`);
        expect(mail).toMatchObject({ mail_kind: 'unread', code: '' });
    });
});
