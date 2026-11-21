import { authorizeStorRequest, type ServerModule, type StorAuthEnv } from '@hearthlog/sdk/server';
import { categoryPick } from './category-pick.js';
import { handleBankMail } from './bank-email.js';
import { durableBankState, FinanceBankState } from './bank-state-object.js';

export { FinanceBankState };

/** The bindings and variables Finance's server part reads. */
interface FinanceEnv extends StorAuthEnv {
    FINANCE_BANK_STATE: DurableObjectNamespace<FinanceBankState>;
    /** The site's mail subdomain (module setting `mailDomain`), e.g. `in.example.cz`; absent until set. */
    FINANCE_MAIL_DOMAIN?: string;
    INTEGRATIONS?: string;
}

const BANK_EMAIL = 'bank-email';
const ADDRESSES_ROUTE = '/api/finance/bank/v1/addresses';

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
                return json({ addresses: forwardingAddresses(env), configured: !!env.FINANCE_MAIL_DOMAIN?.trim() });
            }
            return json({ code: 'not_found', error: 'Not found' }, 404);
        },
    }],
    ai: { 'category-pick': categoryPick },
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
