<script lang="ts">
        import type { AddTransactionEvent } from "@hearthlog/sdk/data";
        import { executeLocalCommand } from "@hearthlog/sdk/data";
        import { format } from "date-fns";
	import IconPlus from "~icons/mdi/plus";

	let { day }: { day: Date } = $props();

	let name = $state("");
	let amount = $state(0);
	let transactionError = $state<string | null>(null);

	async function handleAddTransaction() {
		if (name.trim()) {
			const dayString = format(day, "yyyy-MM-dd");
			const newTransactionEvent: AddTransactionEvent = {
				id: crypto.randomUUID(),
				type: "TRANSACTION_ADDED",
				timestamp: Date.now(),
				payload: {
					id: crypto.randomUUID(),
					name: name.trim(),
					amount: amount,
					due_date: dayString,
					transaction_status: "active",
					transaction_category: "unknown",
				},
			};

			try {
				console.log(
					"[Transaction] Creating transaction event:",
					newTransactionEvent.payload.name,
				);
				console.log("[Transaction] Event details:", {
					id: newTransactionEvent.id,
					type: newTransactionEvent.type,
					timestamp: newTransactionEvent.timestamp,
					transactionId: newTransactionEvent.payload.id,
					dueDate: dayString,
				});

                                await executeLocalCommand(newTransactionEvent);

                                // Reset form only after successful event creation
				name = "";
				amount = 0;
				transactionError = null;
				console.log("[Transaction] Transaction created successfully");
			} catch (error) {
				console.error(
					"[Transaction] Failed to create transaction:",
					error,
				);
				if (error instanceof Error) {
					console.error(
						"[Transaction] Error message:",
						error.message,
					);
					console.error("[Transaction] Error stack:", error.stack);
					transactionError = `Failed to create transaction: ${error.message}`;
				} else {
					transactionError =
						"Failed to create transaction. Please try again.";
				}
				// Don't reset form on error so user can retry
			}
		}
	}
</script>

{#if transactionError}
	<li class="col-span-3 mb-2">
		<div
			class="px-3 py-2 bg-red-100 border border-red-300 text-red-700 rounded text-sm"
		>
			{transactionError}
			<button
				onclick={() => (transactionError = null)}
				class="ml-2 font-bold hover:text-red-900"
				aria-label="Dismiss error"
			>
				✕
			</button>
		</div>
	</li>
{/if}
<li
	class="grid grid-cols-3 items-center py-2 lg:py-1 min-h-12 lg:min-h-10"
>
	<form
		onsubmit={(e) => {
			e.preventDefault();
			handleAddTransaction();
		}}
		class="contents"
	>
		<span>
			<input
				type="text"
				placeholder="Transaction name"
				bind:value={name}
				required
				class="h-10 lg:h-9 w-full px-3 rounded border border-[var(--stor-field-border)] text-base lg:text-sm"
			/>
		</span>
		<span class="text-right">
			<input
				type="number"
				placeholder="Amount (Kč)"
				bind:value={amount}
				required
				step="0.01"
				class="h-10 lg:h-9 w-28 px-3 rounded border border-[var(--stor-field-border)] text-base lg:text-sm text-right"
			/>
		</span>
		<span class="text-right flex items-center justify-end">
			<button
				type="submit"
				aria-label="Add transaction"
				class="p-2 hover:bg-stone-200 focus:outline-none focus:ring-2 focus:ring-stone-300 flex items-center cursor-pointer rounded"
			>
				<IconPlus class="w-5 h-5" />
			</button>
		</span>
	</form>
</li>
