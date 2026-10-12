<script lang="ts">
    import { Drawer } from "@hearthlog/sdk/ui";
    import { Button } from "@hearthlog/sdk/ui";
    import { Input } from "@hearthlog/sdk/ui";
    import { CommandOnly } from "@hearthlog/sdk/ui";
    import { executeLocalCommand } from "@hearthlog/sdk/data";
    import type { Asset } from "../../data/assets.js";
    import type { AddAssetEvent, RemoveAssetEvent, UpdateAssetEvent } from "@hearthlog/sdk/data";
    import { refreshPageData } from "@hearthlog/sdk/runtime";
    import { notify } from "@hearthlog/sdk/runtime";
    import { formatAmount } from "@hearthlog/sdk/format";
    import IconDelete from "~icons/mdi/delete-outline";
    import IconUndo from "~icons/mdi/undo";

    /**
     * Every asset's balance in one sheet (phones): change any of them, add one
     * in the empty last row, mark one for removal; Save writes one command for
     * all changes, so updating balances at the end of a month is one save.
     */
    let { show, assets, onClose }: { show: boolean; assets: Asset[]; onClose: () => void } = $props();

    type Row = { id: string; name: string; amount: number | null; original: Asset | null; removed: boolean };
    let rows = $state<Row[]>([]);
    let saving = $state(false);
    let error = $state("");
    let submissionId = crypto.randomUUID();

    let opened = false;
    $effect(() => {
        if (show && !opened) {
            opened = true;
            rows = [
                ...assets.map((asset) => ({ id: asset.id, name: asset.name, amount: Number(asset.amount), original: asset, removed: false })),
                { id: crypto.randomUUID(), name: "", amount: null, original: null, removed: false },
            ];
            error = "";
            submissionId = crypto.randomUUID();
        } else if (!show) {
            opened = false;
        }
    });

    // A new empty row appears once the last one is being filled.
    $effect(() => {
        const last = rows[rows.length - 1];
        if (last && !last.original && (last.name.trim() || last.amount !== null)) {
            rows = [...rows, { id: crypto.randomUUID(), name: "", amount: null, original: null, removed: false }];
        }
    });

    const total = $derived(rows.reduce((sum, row) => (row.removed ? sum : sum + (Number(row.amount) || 0)), 0));

    function events(): Array<AddAssetEvent | UpdateAssetEvent | RemoveAssetEvent> {
        const timestamp = Date.now();
        const out: Array<AddAssetEvent | UpdateAssetEvent | RemoveAssetEvent> = [];
        for (const row of rows) {
            if (row.original && row.removed) {
                out.push({ id: crypto.randomUUID(), type: "ASSET_REMOVED", timestamp, payload: { id: row.id } });
            } else if (row.original) {
                const name = row.name.trim() || row.original.name;
                const amount = Number(row.amount) || 0;
                if (name !== row.original.name || amount !== Number(row.original.amount)) {
                    out.push({ id: crypto.randomUUID(), type: "ASSET_UPDATED", timestamp, payload: { id: row.id, name, amount } });
                }
            } else if (row.name.trim() && row.amount !== null && !row.removed) {
                out.push({ id: crypto.randomUUID(), type: "ASSET_ADDED", timestamp, payload: { id: row.id, name: row.name.trim(), amount: Number(row.amount), asset_type: "asset" } });
            }
        }
        return out;
    }
    const changes = $derived(events().length);

    async function save(event: SubmitEvent): Promise<void> {
        event.preventDefault();
        if (saving) return;
        const batch = events();
        if (batch.length === 0) { onClose(); return; }
        saving = true;
        error = "";
        try {
            await executeLocalCommand(batch, { submissionId });
            onClose();
            notify.success(batch.length === 1 ? "Assets updated" : `${batch.length} asset changes saved`);
            await refreshPageData("app:assets", "app:transactions");
        } catch (failure) {
            console.error("[Assets] Failed to save balances:", failure);
            error = "The balances could not be saved. Your values are still here.";
        } finally {
            saving = false;
        }
    }
</script>

<CommandOnly onUnavailable={onClose}>
    <Drawer {show} title="Assets" {onClose}>
        <form id="assets-sheet-form" class="flex flex-col" onsubmit={save}>
            {#each rows as row (row.id)}
                <div class="grid grid-cols-[minmax(0,1fr)_8.5rem_2.25rem] items-center gap-2 border-b border-[color-mix(in_srgb,var(--stor-border)_62%,transparent)] py-2 {row.removed ? 'opacity-45' : ''}">
                    <label><span class="sr-only">Asset name</span>
                        <input bind:value={row.name} placeholder={row.original ? "" : "New asset"} disabled={row.removed} class="h-11 w-full min-w-0 bg-transparent text-[15px] font-medium text-[var(--stor-ink)] outline-none placeholder:text-[var(--stor-muted-text)] {row.removed ? 'line-through' : ''}" />
                    </label>
                    <label class="relative"><span class="sr-only">Balance of {row.name || "the new asset"}</span>
                        <Input type="number" inputmode="decimal" step="0.01" bind:value={row.amount} placeholder="0" disabled={row.removed} class="pr-9 text-right" />
                        <span class="pointer-events-none absolute inset-y-0 right-3 flex items-center text-sm text-[var(--stor-muted-text)]">Kč</span>
                    </label>
                    {#if row.original}
                        <button type="button" class="grid h-9 w-9 place-items-center rounded-lg text-[var(--stor-muted-text)]" aria-label={row.removed ? `Keep ${row.name}` : `Remove ${row.name}`} onclick={() => (row.removed = !row.removed)}>
                            {#if row.removed}<IconUndo class="h-5 w-5" />{:else}<IconDelete class="h-5 w-5" />{/if}
                        </button>
                    {:else}<span></span>{/if}
                </div>
            {/each}
            <div class="flex items-baseline justify-between pt-3 text-sm text-[var(--stor-muted-text)]">
                <span>Available now</span><b class="text-xl font-semibold tabular-nums text-[var(--stor-ink)]">{formatAmount(total)} Kč</b>
            </div>
            {#if error}<p class="mt-2 text-sm text-[var(--stor-negative)]" role="alert">{error}</p>{/if}
        </form>
        {#snippet footer()}
            <Button type="submit" form="assets-sheet-form" class="flex-1" disabled={saving}>{saving ? "Saving…" : changes > 0 ? `Save ${changes} ${changes === 1 ? "change" : "changes"}` : "Done"}</Button>
        {/snippet}
    </Drawer>
</CommandOnly>
