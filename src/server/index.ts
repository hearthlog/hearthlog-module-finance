import { authorizeStorRequest, serverIntegrationsFor, type ServerModule, type StorAuthEnv } from '@hearthlog/sdk/server';
import { categoryPick } from './category-pick.js';
import { handleBankMail } from './bank-email.js';
import { durableBankState, durableEbState, FinanceBankState } from './bank-state-object.js';
import { finishApproval, startApproval } from './enablebanking/approval.js';
import { ebConfig, EbError, psuHeadersFrom, type EbEnv } from './enablebanking/client.js';
import { cnbRates } from './enablebanking/rates.js';
import { backgroundDue, presentAllowed, syncSession } from './enablebanking/sync.js';

export { FinanceBankState };

/** The bindings and variables Finance's server part reads. */
interface FinanceEnv extends StorAuthEnv, EbEnv {
    LEDGER: { fetch(request: Request): Promise<Response> };
    LEDGER_AUTH_TOKEN: string;
    FINANCE_BANK_STATE: DurableObjectNamespace<FinanceBankState>;
    /** The site's mail subdomain (module setting `mailDomain`), e.g. `in.example.cz`; absent until set. */
    FINANCE_MAIL_DOMAIN?: string;
    INTEGRATIONS?: string;
}

const BANK_EMAIL = 'bank-email';
const BANK_APPROVAL = 'bank-approval';
const ADDRESSES_ROUTE = '/api/finance/bank/v1/addresses';
const EB_PREFIX = '/api/finance/bank/v1/eb';

/** The forwarding addresses the linking step shows: one per configured `bank-email` integration. */
export function forwardingAddresses(env: Pick<FinanceEnv, 'FINANCE_MAIL_DOMAIN' | 'INTEGRATIONS'>): Array<{ integrationId: string; address: string }> {
    const domain = env.FINANCE_MAIL_DOMAIN?.trim().toLowerCase() ?? '';
    let configured: unknown = [];
    try {
        configured = JSON.parse(env.INTEGRATIONS ?? '[]');
    } catch {
        configured = [];
    }
    if (!Array.isArray(configured) || !domain) return [];
    return configured
        .filter((entry): entry is { id: string; kind: string } => !!entry && typeof entry === 'object' && entry.kind === BANK_EMAIL && typeof entry.id === 'string')
        .map((entry) => ({ integrationId: entry.id, address: `${entry.id}@${domain}` }));
}

function json(body: unknown, status = 200): Response {
    return Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
}

function redirect(location: string): Response {
    return new Response(null, { status: 302, headers: { Location: location, 'Cache-Control': 'no-store' } });
}

/** The bank-approval integration (and its log) Revolut writes through; the first configured one. */
function approvalIntegration(env: FinanceEnv) {
    return serverIntegrationsFor(env as never, BANK_APPROVAL)[0] ?? null;
}

/** Start, callback and refresh of a bank approval (Revolut). The caller is already a verified Access user. */
async function handleApproval(request: Request, env: FinanceEnv, url: URL): Promise<Response> {
    const config = ebConfig(env);
    const integration = approvalIntegration(env);
    if (!config || !integration) return json({ code: 'not_configured', error: 'Linking by bank approval is not set up for this site' }, 503);
    const store = durableEbState(env.FINANCE_BANK_STATE, integration.id);
    const now = Date.now();
    try {
        if (url.pathname === `${EB_PREFIX}/start` && request.method === 'POST') {
            const body = await request.json().catch(() => ({})) as { bank?: string };
            return json(await startApproval({ config, store, bank: body.bank ?? 'revolut', redirectUrl: `${url.origin}${EB_PREFIX}/callback`, now }));
        }
        if (url.pathname === `${EB_PREFIX}/callback` && request.method === 'GET') {
            const code = url.searchParams.get('code');
            const state = url.searchParams.get('state');
            if (!code || !state) return redirect(`/finance?bankLinkError=${encodeURIComponent(url.searchParams.get('error') ?? 'cancelled')}`);
            const finished = await finishApproval({ config, store, integration, code, state, now, psu: psuHeadersFrom(request), rates: cnbRates() });
            if (!finished) return redirect('/finance?bankLinkError=expired');
            return redirect(`/finance?bankLinked=${encodeURIComponent(finished.bank)}`);
        }
        if (url.pathname === `${EB_PREFIX}/refresh` && request.method === 'POST') {
            const rates = cnbRates();
            const outcomes = [];
            for (const session of await store.listSessions()) {
                if (!presentAllowed(session, now)) continue;
                outcomes.push(await syncSession({ integration, session, config, store, rates, now, psu: psuHeadersFrom(request) }));
            }
            return json({ outcomes });
        }
    } catch (error) {
        console.error('[finance] bank approval failed', error);
        if (url.pathname.endsWith('/callback')) return redirect('/finance?bankLinkError=failed');
        return json({ code: error instanceof EbError ? error.code : 'failed', error: 'The bank could not be reached' }, 502);
    }
    return json({ code: 'not_found', error: 'Not found' }, 404);
}

/**
 * Finance's part of the gateway Worker: the AI decision that suggests a transaction's category, and the bank mail
 * forwarded to the site's mail subdomain, which becomes accounts, balances and rows.
 */
const finance: ServerModule<Env> = {
    id: 'org.stor.finance',
    routes: [{
        prefix: '/api/finance/bank',
        async handle(request, rawEnv) {
            const env = rawEnv as unknown as FinanceEnv;
            const url = new URL(request.url);
            const origin = request.headers.get('Origin');
            if (origin !== null && origin !== url.origin) return json({ code: 'origin_not_allowed', error: 'Cross-origin requests are not allowed' }, 403);
            try {
                await authorizeStorRequest(request, env);
            } catch {
                return json({ code: 'forbidden', error: 'Hearthlog access is required' }, 403);
            }
            if (url.pathname === ADDRESSES_ROUTE && request.method === 'GET') {
                return json({
                    addresses: forwardingAddresses(env),
                    configured: !!env.FINANCE_MAIL_DOMAIN?.trim(),
                    approval: !!ebConfig(env) && !!approvalIntegration(env),
                });
            }
            if (url.pathname.startsWith(`${EB_PREFIX}/`)) return handleApproval(request, env, url);
            return json({ code: 'not_found', error: 'Not found' }, 404);
        },
    }],
    ai: { 'category-pick': categoryPick },
    /** Background fetch of every bank approval, at most every six hours (the bank allows about four a day). */
    async hourly(rawEnv, { now }) {
        const env = rawEnv as unknown as FinanceEnv;
        const config = ebConfig(env);
        if (!config) return;
        const rates = cnbRates();
        for (const integration of serverIntegrationsFor(env as never, BANK_APPROVAL)) {
            const store = durableEbState(env.FINANCE_BANK_STATE, integration.id);
            for (const session of await store.listSessions()) {
                if (backgroundDue(session, now)) await syncSession({ integration, session, config, store, rates, now });
            }
        }
    },
    email: {
        async [BANK_EMAIL]({ env: rawEnv, integration, email, now, reject }) {
            const env = rawEnv as unknown as FinanceEnv;
            await handleBankMail({
                integration,
                raw: email.raw,
                now,
                reject,
                store: durableBankState(env.FINANCE_BANK_STATE, integration.id),
                mailDomain: env.FINANCE_MAIL_DOMAIN?.trim().toLowerCase() ?? '',
            });
        },
    },
};

export default finance;
