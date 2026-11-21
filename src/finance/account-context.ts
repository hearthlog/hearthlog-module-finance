import { getContext, setContext } from 'svelte';

/** What a timeline row shows of the account it belongs to. */
export interface RowAccount {
    name: string;
    mark: string;
}

const KEY = Symbol('finance-row-accounts');

/** The month page shares account names with every timeline row, so the list components need no new props. */
export function provideRowAccounts(read: () => ReadonlyMap<string, RowAccount>): void {
    setContext(KEY, read);
}

export function rowAccounts(): () => ReadonlyMap<string, RowAccount> {
    return getContext<(() => ReadonlyMap<string, RowAccount>) | undefined>(KEY) ?? (() => new Map());
}

/** What a looks-paid plan row can do: confirm the bank row settles it, or keep them apart. */
export interface PlanActions {
    confirm(planId: string): Promise<void>;
    decline(planId: string): Promise<void>;
}

const PLAN_KEY = Symbol('finance-plan-actions');

export function providePlanActions(actions: PlanActions): void {
    setContext(PLAN_KEY, actions);
}

export function planActions(): PlanActions | null {
    return getContext<PlanActions | undefined>(PLAN_KEY) ?? null;
}
