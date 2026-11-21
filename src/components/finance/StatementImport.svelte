<script lang="ts">
    import { format, parseISO } from "date-fns";
    import { Button, CommandOnly } from "@hearthlog/sdk/ui";
    import { notify } from "@hearthlog/sdk/runtime";
    import type { Asset } from "../../data/assets.js";
    import { applyStatementImport, planStatementImport, StatementImportError, type StatementPlan } from "../../finance/statement-import.js";

    /** Pick a statement PDF, see what it adds and what is already there, then import. The file stays on this device. */
    let { assets, today, onDone }: { assets: Asset[]; today: string; onDone?: (added: number) => void } = $props();

    const inputId = $props.id();
    let plan = $state<StatementPlan | null>(null);
    let error = $state("");
    let busy = $state(false);
    let added = $state<number | null>(null);

    const fresh = $derived(plan?.rows.filter((row) => row.status === "new").length ?? 0);
    const there = $derived(plan ? plan.rows.length - fresh : 0);
    const failed = $derived(plan?.checks.filter((check) => !check.ok) ?? []);
    const period = $derived(plan?.period.from && plan.period.to ? `${format(parseISO(plan.period.from), "d MMM")} – ${format(parseISO(plan.period.to), "d MMM yyyy")}` : "");

    async function pick(event: Event): Promise<void> {
        // The event's target is gone once the first await returns; keep the input to clear it afterwards.
        const input = event.currentTarget as HTMLInputElement;
        const file = input.files?.[0];
        if (!file) return;
        busy = true;
        error = "";
        plan = null;
        added = null;
        try {
            plan = await planStatementImport(new Uint8Array(await file.arrayBuffer()), assets);
        } catch (failure) {
            error = failure instanceof StatementImportError ? failure.message : "The file could not be read.";
            if (!(failure instanceof StatementImportError)) console.error("[StatementImport]", failure);
        } finally {
            busy = false;
            input.value = "";
        }
    }

    async function run(): Promise<void> {
        if (!plan) return;
        busy = true;
        try {
            added = await applyStatementImport(plan, today);
            notify.success(`${added} ${added === 1 ? "row" : "rows"} imported`);
            onDone?.(added);
        } catch (failure) {
            error = failure instanceof Error ? failure.message : "The rows could not be imported.";
        } finally {
            busy = false;
        }
    }
</script>

<div class="statement">
    <label class="pick" for={inputId}>
        <input id={inputId} type="file" accept="application/pdf,.pdf" disabled={busy} onchange={pick} />
        <span>{busy && !plan ? "Reading the statement…" : plan ? "Pick another statement" : "Choose a statement PDF"}</span>
    </label>
    <p class="hint">Download it from the bank's internet banking. It is read on this device and not uploaded.</p>
    {#if error}<p class="note negative" role="alert">{error}</p>{/if}
    {#if plan}
        <div class="summary">
            <b>{plan.bank.name} {plan.accountDisplay}</b>{#if period}<span> · {period}</span>{/if}
            {#if !plan.asset}
                <p class="note warn">This account is not linked yet. Link it first (its first notification email does that), then add the statement.</p>
            {:else if added !== null}
                <p class="note ok">{added} {added === 1 ? "row" : "rows"} added to {plan.asset.name}. {there} were already there.</p>
            {:else}
                <p>{fresh} new {fresh === 1 ? "row" : "rows"} for {plan.asset.name}{there ? `, ${there} already there from emails or an earlier import` : ""}. Rows before this month arrive reviewed.</p>
            {/if}
            {#if failed.length}
                <ul class="checks">
                    {#each failed as check (check.label)}<li>{check.label}: {check.detail}</li>{/each}
                </ul>
            {/if}
        </div>
        {#if plan.asset && added === null}
            <CommandOnly>
                <Button size="sm" disabled={busy || fresh === 0} onclick={run}>{fresh === 0 ? "Nothing new to import" : `Import ${fresh} ${fresh === 1 ? "row" : "rows"}`}</Button>
            </CommandOnly>
        {/if}
    {/if}
</div>

<style>
    .statement { display: flex; flex-direction: column; align-items: flex-start; gap: 8px; }
    .pick { position: relative; display: inline-flex; height: 34px; align-items: center; padding: 0 12px; border-radius: 10px; background: var(--stor-surface-raised); box-shadow: var(--stor-elevation-2); font-size: 13px; font-weight: 600; cursor: pointer; }
    .pick input { position: absolute; inset: 0; opacity: 0; cursor: pointer; }
    .pick:focus-within { outline: 2px solid var(--stor-focus); }
    .hint { margin: 0; font-size: 12px; color: var(--stor-muted-text); }
    .summary { display: flex; flex-direction: column; gap: 6px; font-size: 13px; }
    .summary p { margin: 0; }
    .summary span { color: var(--stor-muted-text); }
    .note { padding: 8px 10px; border-radius: 10px; font-size: 12px; line-height: 17px; }
    .note.warn { background: var(--stor-warning-soft); }
    .note.ok { background: var(--stor-positive-soft, var(--stor-surface-muted)); color: var(--stor-positive); }
    .note.negative { background: var(--stor-negative-soft); color: var(--stor-negative); }
    .checks { margin: 0; padding-left: 18px; font-size: 12px; color: var(--stor-warning); }
</style>
