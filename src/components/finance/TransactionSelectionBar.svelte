<script lang="ts">
    import type { TransactionSelectionSummary } from "../../data/transactions.js";
    import { queryDatabase } from "@hearthlog/sdk/data";
    import { formatMoney } from "@hearthlog/sdk/format";
    import { Button } from "@hearthlog/sdk/ui";
    import { DatePicker } from "@hearthlog/sdk/ui";
    import { Field } from "@hearthlog/sdk/ui";
    import { CommandOnly } from "@hearthlog/sdk/ui";
    import { CommandModal } from "@hearthlog/sdk/ui";
    import { CommandConfirmDialog } from "@hearthlog/sdk/ui";
    import type { RowLike } from "./TimelineRowItem.svelte";

    let {
        selected,
        visibleCount,
        today,
        onClear,
        onSelectAll,
        onMove,
        onSetDone,
        onDelete,
    }: {
        /** Selected rows, in list order. */
        selected: RowLike[];
        visibleCount: number;
        today: string;
        onClear: () => void;
        onSelectAll: () => void;
        onMove: (rows: RowLike[], date: string) => Promise<void>;
        /** Marks the selected plans done, or restores rows done ahead of their day to plans. */
        onSetDone: (rows: RowLike[], done: boolean) => Promise<void>;
        onDelete: (rows: RowLike[]) => Promise<void>;
    } = $props();

    const empty: TransactionSelectionSummary = { count: 0, incomeTotal: 0, expenseTotal: 0, netTotal: 0 };
    let summary = $state<TransactionSelectionSummary>({ ...empty });
    let summaryLoading = $state(false);
    let busy = $state(false);
    let moveOpen = $state(false);
    let moveDate = $state("");
    let moveError = $state("");
    let confirmDeleteOpen = $state(false);

    const count = $derived(selected.length);
    const allSelected = $derived(count > 0 && count === visibleCount);
    // Plans can be marked done early; a row done ahead of its day can go back
    // to plans. Rows whose day has passed are done by date and offer neither.
    const statusAction = $derived.by(() => {
        const plans = selected.filter((row) => row.kind === "planned");
        if (plans.length > 0) return { label: "Mark done", done: true, rows: plans };
        const ahead = selected.filter((row) => row.kind === "done" && row.date >= today);
        return ahead.length > 0 ? { label: "Restore", done: false, rows: ahead } : null;
    });
    const noun = (value: number) => (value === 1 ? "transaction" : "transactions");
    const deleteMessage = $derived.by(() => {
        const names = selected.map((row) => row.name || "Untitled");
        if (names.length === 1) return `Delete “${names[0]}”?`;
        return `Remove these ${names.length} transactions: ${names.slice(0, 10).join(", ")}${names.length > 10 ? ", …" : ""}?`;
    });

    // Totals are a separate SQL query so ticking a checkbox never re-scans rows.
    $effect(() => {
        const ids = selected.map((row) => row.id);
        if (ids.length === 0) {
            summary = { ...empty };
            summaryLoading = false;
            return;
        }
        let cancelled = false;
        summaryLoading = true;
        queryDatabase((repositories) => repositories.transactions.getSelectionSummary(ids))
            .then((result) => { if (!cancelled) summary = result; })
            .catch(() => { if (!cancelled) summary = { ...empty }; })
            .finally(() => { if (!cancelled) summaryLoading = false; });
        return () => { cancelled = true; };
    });

    function openMove(): void {
        moveDate = selected.map((row) => row.date).sort()[0] ?? today;
        moveError = "";
        moveOpen = true;
    }

    async function run(action: () => Promise<void>): Promise<boolean> {
        if (busy || count === 0) return false;
        busy = true;
        try {
            await action();
            return true;
        } catch {
            return false;
        } finally {
            busy = false;
        }
    }

    async function confirmMove(): Promise<void> {
        const date = moveDate.trim().slice(0, 10);
        if (!date) {
            moveError = "Choose a date first.";
            return;
        }
        moveError = "";
        const targets = selected;
        const moved = await run(() => onMove(targets, date));
        if (moved) moveOpen = false;
        else moveError = "The transactions could not be moved. Your values are still here.";
    }

    async function toggleDone(): Promise<void> {
        const action = statusAction;
        if (!action) return;
        await run(() => onSetDone(action.rows, action.done));
    }

    async function confirmDelete(): Promise<void> {
        confirmDeleteOpen = false;
        const targets = selected;
        await run(() => onDelete(targets));
    }
</script>

{#snippet totals()}
    {#if summaryLoading}
        <span class="text-[var(--stor-muted-text)]">Calculating totals…</span>
    {:else}
        <div><span class="text-[var(--stor-muted-text)]">Income</span> <strong class="ml-1 tabular-nums">{formatMoney(summary.incomeTotal, { signed: true })}</strong></div>
        <div><span class="text-[var(--stor-muted-text)]">Expenses</span> <strong class="ml-1 tabular-nums">{formatMoney(-summary.expenseTotal)}</strong></div>
        <div><span class="text-[var(--stor-muted-text)]">Net</span> <strong class="ml-1 tabular-nums">{formatMoney(summary.netTotal)}</strong></div>
    {/if}
{/snippet}

{#if count > 0}
    <div class="sticky top-0 z-[4] hidden lg:block">
        <div class="flex flex-wrap items-center gap-x-3 gap-y-1 bg-[var(--stor-surface-muted)] px-4 py-2 text-xs text-[var(--stor-muted-text)]" role="status">
            {#if allSelected}
                <span>All {count} {noun(count)} in this view {count === 1 ? "is" : "are"} selected.</span>
                <button type="button" onclick={onClear} class="font-semibold text-[var(--stor-accent-strong)] hover:underline">Clear selection</button>
            {:else}
                <span>{count} of {visibleCount} {noun(visibleCount)} in this view {count === 1 ? "is" : "are"} selected.</span>
                <button type="button" onclick={onSelectAll} class="font-semibold text-[var(--stor-accent-strong)] hover:underline">Select all {visibleCount}</button>
            {/if}
        </div>
        <div class="flex flex-wrap items-center gap-x-6 gap-y-2 bg-[var(--stor-accent-soft)] px-4 py-2.5 text-sm" aria-label="Selected transaction totals">
            <strong>{count} selected</strong>
            {@render totals()}
            <div class="ml-auto flex items-center gap-2">
                <CommandOnly>
                    <Button size="sm" disabled={busy} onclick={openMove}>Move</Button>
                    {#if statusAction}<Button size="sm" variant="secondary" disabled={busy} onclick={() => void toggleDone()}>{statusAction.label}</Button>{/if}
                    <Button size="sm" variant="ghost" class="text-[var(--stor-negative)]" disabled={busy} onclick={() => (confirmDeleteOpen = true)}>Delete</Button>
                </CommandOnly>
                <button type="button" onclick={onClear} class="h-9 px-2 text-sm text-[var(--stor-accent-strong)]">Clear selection</button>
            </div>
        </div>
    </div>

    <div class="fixed inset-x-3 bottom-[calc(var(--stor-mobile-bottom-inset)+var(--stor-mobile-nav-height)+var(--stor-mobile-stack-gap))] z-40 md:left-[116px] rounded-2xl bg-[var(--stor-surface-raised)] p-3 shadow-[var(--stor-elevation-3)] lg:hidden" aria-label="Selected transaction totals">
        <div class="flex items-center justify-between gap-2">
            <strong>{count} selected</strong>
            <div class="flex items-center gap-3 text-sm">
                {#if !allSelected}<button type="button" onclick={onSelectAll} class="min-h-11 text-[var(--stor-accent-strong)]">Select all {visibleCount}</button>{/if}
                <button type="button" onclick={onClear} class="min-h-11 text-[var(--stor-accent-strong)]">Cancel</button>
            </div>
        </div>
        <div class="mt-1 grid grid-cols-3 gap-2 text-sm [&_div]:flex [&_div]:flex-col">
            {@render totals()}
        </div>
        <CommandOnly>
            <div class="mt-3 grid gap-2 {statusAction ? 'grid-cols-3' : 'grid-cols-2'}">
                {#if statusAction}<Button class="md:hidden" disabled={busy} onclick={() => void toggleDone()}>{statusAction.label === "Mark done" ? "Done" : statusAction.label}</Button>{/if}
                <Button class={statusAction ? "max-md:!bg-transparent max-md:!text-[var(--stor-ink)] max-md:!shadow-none" : ""} disabled={busy} onclick={openMove}>Move</Button>
                {#if statusAction}<Button variant="secondary" class="max-md:hidden" disabled={busy} onclick={() => void toggleDone()}>{statusAction.label}</Button>{/if}
                <Button variant="ghost" class="bg-[var(--stor-negative-soft)] text-[var(--stor-negative)]" disabled={busy} onclick={() => (confirmDeleteOpen = true)}>Delete</Button>
            </div>
        </CommandOnly>
    </div>
{/if}

<CommandModal show={moveOpen} title={count === 1 ? "Move 1 transaction" : `Move ${count} transactions`} onClose={() => (moveOpen = false)}>
    <p class="text-sm text-[var(--stor-muted-text)]">Pick the new date for the selected {noun(count)}.</p>
    <Field label="New date" htmlFor="move-transactions-date" class="mt-4">
        <DatePicker id="move-transactions-date" bind:value={moveDate} clearable={false} />
    </Field>
    {#if moveError}
        <p class="mt-2 text-sm text-[var(--stor-negative)]" role="alert">{moveError}</p>
    {/if}
    <div class="mt-5 flex items-center justify-end gap-2">
        <Button variant="secondary" onclick={() => (moveOpen = false)} disabled={busy}>Cancel</Button>
        <Button onclick={() => void confirmMove()} disabled={busy || !moveDate.trim()}>{busy ? "Moving…" : "Move here"}</Button>
    </div>
</CommandModal>

<CommandConfirmDialog
    show={confirmDeleteOpen}
    title={count === 1 ? "Delete transaction?" : `Delete ${count} transactions?`}
    message={deleteMessage}
    onConfirm={confirmDelete}
    onCancel={() => (confirmDeleteOpen = false)}
/>
