/**
 * The account actions that are ordinary local commands: they work offline and reach every device by sync.
 * Linking itself is a provider's job (step 4 on); these only change what is already in the ledger.
 */

import {
    executeLocalCommand,
    type AddAssetEvent,
    type AddTransactionEvent,
    type RemoveAssetEvent,
    type UpdateAssetEvent,
} from '@hearthlog/sdk/data';
import type { Asset } from '../data/assets.js';

/** The fields a link adds to an asset; unlinking clears them so it is a hand-kept asset again. */
export interface AssetLink {
    provider: string;
    connection_id: string;
    account_hash: string;
    account_kind: string;
    currency?: string;
    native_amount?: number;
    balance_type?: string;
    balance_source?: string;
    synced_at?: string;
}

function update(payload: UpdateAssetEvent['payload']): Promise<unknown> {
    return executeLocalCommand({ id: crypto.randomUUID(), type: 'ASSET_UPDATED', timestamp: Date.now(), payload } satisfies UpdateAssetEvent);
}

/**
 * Turns a hand-kept asset into a linked one instead of adding a second asset for the same money. Its name stays the
 * user's; the balance is the bank's from now on.
 */
export function linkAsset(asset: Pick<Asset, 'id'>, link: AssetLink, balance: number): Promise<unknown> {
    return update({ id: asset.id, link: 'bank', amount: balance, sync_issue: '', issue_count: 0, ...link });
}

/** Ends the link but keeps the asset and its last balance, to be kept by hand from now on. */
export function unlinkAsset(asset: Pick<Asset, 'id'>): Promise<unknown> {
    return update({
        id: asset.id,
        link: 'manual',
        provider: '',
        connection_id: '',
        balance_type: '',
        balance_source: '',
        sync_issue: '',
        issue_count: 0,
    });
}

/** Adds a hand-kept asset, or renames and re-balances one. */
export function saveHandKeptAsset(editing: Pick<Asset, 'id'> | null, draft: { name: string; amount: number }): Promise<unknown> {
    if (editing) return update({ id: editing.id, name: draft.name, amount: draft.amount });
    return executeLocalCommand({
        id: crypto.randomUUID(),
        type: 'ASSET_ADDED',
        timestamp: Date.now(),
        payload: { id: crypto.randomUUID(), name: draft.name, amount: draft.amount, asset_type: 'asset' },
    } satisfies AddAssetEvent);
}

export function removeAsset(asset: Pick<Asset, 'id'>): Promise<unknown> {
    return executeLocalCommand({ id: crypto.randomUUID(), type: 'ASSET_REMOVED', timestamp: Date.now(), payload: { id: asset.id } } satisfies RemoveAssetEvent);
}

/**
 * Accepts a balance gap as it is: one done row in `other` explains the difference so history still sums up, and the
 * account is clear again. The bank's balance already holds; this only records why.
 */
export async function acceptBalanceGap(asset: Pick<Asset, 'id' | 'issue_amount'>, today: string): Promise<void> {
    const amount = Number(asset.issue_amount) || 0;
    if (amount !== 0) {
        await executeLocalCommand({
            id: crypto.randomUUID(),
            type: 'TRANSACTION_ADDED',
            timestamp: Date.now(),
            payload: {
                id: crypto.randomUUID(),
                name: 'Balance adjustment',
                amount,
                due_date: today,
                transaction_status: 'archived',
                transaction_category: 'other',
                category_source: 'manual',
                asset_id: asset.id,
                review: 'reviewed',
            },
        } satisfies AddTransactionEvent);
    }
    await update({ id: asset.id, sync_issue: '', issue_amount: 0 });
}
