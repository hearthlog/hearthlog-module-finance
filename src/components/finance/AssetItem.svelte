<script lang="ts">
	import { formatMoney } from "@hearthlog/sdk/format";
	import type { Asset } from "../../data/assets.js";
	import { type RemoveAssetEvent } from "@hearthlog/sdk/data";
        import { executeLocalCommand } from "@hearthlog/sdk/data";
        import { notify } from "@hearthlog/sdk/runtime";
    import IconPencil from "~icons/mdi/pencil";
	import IconDeleteOutline from "~icons/mdi/delete-outline";
	import { CommandConfirmDialog } from "@hearthlog/sdk/ui";
	import { CommandOnly } from "@hearthlog/sdk/ui";
	import { SyncStateBadge } from "@hearthlog/sdk/ui";

	let {
		asset,
		onEdit,
	} = $props<{
		asset: Asset;
		onEdit: () => void;
	}>();

	let showConfirmDelete = $state(false);
	let pending = $state(false);

	const assetMoney = { format: (value: number) => formatMoney(value) };

	async function dispatchEvent(event: RemoveAssetEvent) {
		pending = true;
                try {
                        await executeLocalCommand(event);
			return true;
                } catch (error) {
                        console.error("[AssetItem] Failed to dispatch event:", error);
			notify.error("Could not update the asset");
			return false;
		} finally {
			pending = false;
                }
	}

	async function handleDelete() {
		const deleteEvent: RemoveAssetEvent = {
			id: crypto.randomUUID(),
			type: "ASSET_REMOVED",
			timestamp: Date.now(),
			payload: { id: asset.id },
		};
		if (await dispatchEvent(deleteEvent)) {
			notify.success("Asset deleted");
		}
	}

</script>

<CommandOnly onUnavailable={() => {
	showConfirmDelete = false;
}} />

<li
	class="grid min-h-9 grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-x-2 py-1.5 text-sm last:border-b-0"
>
		<span class="flex min-w-0 items-center gap-2"><span class="truncate font-medium text-[var(--stor-ink)]">{asset.name}</span><SyncStateBadge entityId={`asset:${asset.id}`} /></span>
		<span class="text-right tabular-nums font-semibold text-[var(--stor-positive)]"
			>{assetMoney.format(asset.amount)}</span
		>
		<CommandOnly>
			<span class="text-right flex items-center justify-end space-x-1">
				<button
					aria-label="Edit"
					class="flex cursor-pointer items-center rounded-lg p-1.5 text-[var(--stor-muted-text)] transition hover:bg-[var(--stor-surface-muted)] hover:text-[var(--stor-ink)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--stor-focus)]"
					onclick={onEdit}
					disabled={pending}
				>
					<IconPencil class="h-4.5 w-4.5" />
				</button>
				<button
					aria-label="Delete"
					class="flex cursor-pointer items-center rounded-lg p-1.5 text-[var(--stor-muted-text)] transition hover:bg-[var(--stor-negative-soft)] hover:text-[var(--stor-negative)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--stor-focus)]"
					onclick={() => (showConfirmDelete = true)}
					disabled={pending}
				>
					<IconDeleteOutline class="h-4.5 w-4.5" />
				</button>
			</span>
		</CommandOnly>
</li>

<CommandConfirmDialog
	show={showConfirmDelete}
	title="Delete asset?"
	message={`Delete “${asset.name}”?`}
	onConfirm={async () => {
		showConfirmDelete = false;
		await handleDelete();
	}}
	onCancel={() => (showConfirmDelete = false)}
/>
