<script lang="ts">
	let {
		newAssetName = $bindable(),
		newAssetAmount = $bindable(),
		onsubmit = () => {},
		oncancel = () => {},
		pending = false,
	}: {
		newAssetName: string;
		newAssetAmount: number;
		onsubmit?: () => void;
		oncancel?: () => void;
		pending?: boolean;
	} = $props();

	function handleSubmit(event: SubmitEvent) {
		event.preventDefault();
		onsubmit();
	}
</script>

<form onsubmit={handleSubmit} class="space-y-2.5 rounded-lg bg-[var(--stor-surface-muted)] p-2.5">
	<div class="grid gap-2 sm:grid-cols-2">
		<label class="block text-xs font-semibold text-stone-600">
			Asset name
			<input
				type="text"
				bind:value={newAssetName}
				placeholder="Savings account"
				required
				autofocus
				class="mt-1 h-9 min-w-0 w-full rounded-lg border border-[var(--stor-field-border)] bg-white px-2.5 text-sm"
			/>
		</label>
		<label class="block text-xs font-semibold text-stone-600">
			Balance
			<input
				type="number"
				bind:value={newAssetAmount}
				placeholder="0.00"
				required
				min="0.01"
				step="0.01"
				class="mt-1 h-9 min-w-0 w-full rounded-lg border border-[var(--stor-field-border)] bg-white px-2.5 text-right text-sm tabular-nums"
			/>
		</label>
	</div>
	<div class="flex justify-end gap-2">
		<button type="button" class="rounded-lg px-2.5 py-1.5 text-sm font-semibold text-stone-600 hover:bg-stone-200" onclick={oncancel} disabled={pending}>Cancel</button>
			<button
				type="submit"
                class="min-h-11 rounded-xl bg-[var(--stor-action)] px-3 text-sm font-semibold text-[var(--stor-action-text)] hover:bg-[var(--stor-action-hover)] disabled:opacity-50 sm:min-h-9"
				disabled={pending}
			>
				{pending ? "Adding..." : "Add asset"}
			</button>
	</div>
</form>
