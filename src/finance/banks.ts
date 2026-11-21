/** The banks Finance links, and how each one reaches it. More banks later, one entry (and one parser) each. */

export type BankProvider = 'email' | 'enable_banking';

export interface BankInfo {
    id: string;
    name: string;
    /** Two letters for the neutral bank mark; the name does the telling. */
    mark: string;
    provider: BankProvider;
    /** Email banks: the domain their notifications are signed by. */
    senderDomain?: string;
}

const BANKS: Record<string, BankInfo> = {
    csob: { id: 'csob', name: 'ČSOB', mark: 'ČS', provider: 'email', senderDomain: 'csob.cz' },
    airbank: { id: 'airbank', name: 'Air Bank', mark: 'AB', provider: 'email', senderDomain: 'airbank.cz' },
    revolut: { id: 'revolut', name: 'Revolut', mark: 'RE', provider: 'enable_banking' },
};

export function bankInfo(id: string | null | undefined): BankInfo | null {
    return id ? BANKS[id] ?? null : null;
}

export const PROVIDER_LABELS: Record<BankProvider, { short: string; long: string }> = {
    email: { short: 'email', long: 'by notification email' },
    enable_banking: { short: 'synced', long: 'by bank approval' },
};
