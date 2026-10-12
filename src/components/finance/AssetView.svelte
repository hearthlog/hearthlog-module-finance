<script lang="ts">
    import { formatMoney } from "@hearthlog/sdk/format";
    import { currentPageResource } from "@hearthlog/sdk/runtime";
    import { DataValue } from "@hearthlog/sdk/ui";
    import { DataPlaceholder } from "@hearthlog/sdk/ui";
    const resource = currentPageResource();
    const loading = $derived(resource?.().loading ?? false);
    import type { Asset } from "../../data/assets.js";
    import type { AddAssetEvent, UpdateAssetEvent } from "@hearthlog/sdk/data";
    import { executeLocalCommand } from "@hearthlog/sdk/data";
    import { notify } from "@hearthlog/sdk/runtime";
    import AssetItem from "./AssetItem.svelte";
    import AssetDrawer from "./AssetDrawer.svelte";
    import { CommandOnly } from "@hearthlog/sdk/ui";
    import IconPlus from "~icons/mdi/plus";

    let { assets, assetsSum, onUpdateAll } = $props<{
        assets: Asset[];
        assetsSum: number;
        /** Opens every balance in one sheet with one save. */
        onUpdateAll?: () => void;
    }>();

    let isAdding = $state(false);
    let editingAsset = $state<Asset | null>(null);

    const assetMoney = { format: (value: number) => formatMoney(value) };

    function compareAssets(a: Asset, b: Asset): number {
        const ac = new Date(a.created_at).getTime();
        const bc = new Date(b.created_at).getTime();
        if (ac !== bc) return ac - bc; // earlier first
        return a.id.localeCompare(b.id);
    }

    const sortedAssets = $derived.by<Asset[]>(() => {
        return [...assets].sort(compareAssets) as Asset[];
    });

    let assetError = $state<string | null>(null);

    async function handleSaveAsset(draft: { name: string; amount: number }) {
        if (editingAsset) {
            const updateEvent: UpdateAssetEvent = {
                id: crypto.randomUUID(),
                type: "ASSET_UPDATED",
                timestamp: Date.now(),
                payload: {
                    id: editingAsset.id,
                    name: draft.name,
                    amount: draft.amount,
                },
            };
            await executeLocalCommand(updateEvent);
            editingAsset = null;
            notify.success("Asset updated");
            return;
        }

        const newAssetEvent: AddAssetEvent = {
            id: crypto.randomUUID(),
            type: "ASSET_ADDED",
            timestamp: Date.now(),
            payload: {
                id: crypto.randomUUID(),
                name: draft.name,
                amount: draft.amount,
                asset_type: "asset",
            },
        };

        try {
            await executeLocalCommand(newAssetEvent);
            assetError = null;
            isAdding = false;
            notify.success("Asset added");
        } catch (error) {
            console.error("[Asset] Failed to create asset:", error);
            assetError =
                error instanceof Error
                    ? `Failed to create asset: ${error.message}`
                    : "Failed to create asset. Please try again.";
            throw error;
        }
    }

    function closeAssetDrawer() {
        isAdding = false;
        editingAsset = null;
        assetError = null;
    }
</script>

<CommandOnly
    onUnavailable={() => {
        closeAssetDrawer();
    }}
/>

<div class="text-sm sm:text-base">
    <svelte:boundary>
        <div class="stor-today-card overflow-hidden">
            <div class="flex items-center justify-between gap-3 px-4 py-3">
                <div class="min-w-0">
                    <p class="text-sm font-semibold text-[var(--stor-ink)]">Current assets</p>
                </div>
                <CommandOnly>
                    {#if !isAdding && !editingAsset}
                        {#if onUpdateAll && sortedAssets.length > 1}
                            <button type="button" class="ml-auto mr-2 shrink-0 text-xs font-semibold text-[var(--stor-accent-text)]" onclick={onUpdateAll}>Update balances</button>
                        {/if}
                        <button
                            type="button"
                            class="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-[var(--stor-surface)] px-2.5 py-1.5 text-xs font-semibold text-[var(--stor-ink)] transition hover:border-[var(--stor-field-border)] hover:bg-[var(--stor-surface-muted)]"
                            onclick={() => (isAdding = true)}
                        >
                            <IconPlus class="h-3.5 w-3.5" /> Add
                        </button>
                    {/if}
                </CommandOnly>
            </div>
            {#if assetError}
                <div class="mx-4 mt-3 rounded-lg border border-[color-mix(in_srgb,var(--stor-negative),transparent_35%)] bg-[var(--stor-negative-soft)] px-3 py-2 text-sm text-[var(--stor-negative)]">
                    {assetError}
                    <button
                        onclick={() => (assetError = null)}
                        class="ml-2 font-bold"
                        aria-label="Dismiss error"
                    >
                        ✕
                    </button>
                </div>
            {/if}
            <ul class="px-3 py-1.5">
                {#if loading}
                    <li><DataPlaceholder rows={2} /></li>
                {:else}
                    {#each sortedAssets as asset (asset.id)}
                        <AssetItem {asset} onEdit={() => (editingAsset = asset)} />
                    {/each}
                {/if}
            </ul>
            {#if !loading && sortedAssets.length > 0}
                <div class="mx-4 flex items-center justify-between border-t border-[var(--stor-border)] py-2 text-sm font-semibold text-[var(--stor-ink)]">
                    <span>Total assets</span><span class="tabular-nums"><DataValue>{assetMoney.format(assetsSum)}</DataValue></span>
                </div>
            {/if}
            {#if !loading && sortedAssets.length === 0 && !isAdding}
                <div class="px-4 pb-4 pt-1 text-sm leading-5 text-[var(--stor-muted-text)]">
                    No current assets yet. Add cash, savings, or investments to establish what you have now.
                </div>
            {/if}
        </div>
        {#snippet pending()}
            <p>..</p>
        {/snippet}
    </svelte:boundary>
</div>

<AssetDrawer
    show={isAdding || !!editingAsset}
    asset={editingAsset}
    onClose={closeAssetDrawer}
    onSave={handleSaveAsset}
/>
