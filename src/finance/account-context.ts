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
