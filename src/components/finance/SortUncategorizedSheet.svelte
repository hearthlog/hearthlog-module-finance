<script lang="ts">
    import { monthWindow } from "../../finance/timeline.js";
    import { queryDatabase } from "@hearthlog/sdk/data";
    import { categoryLabel, TRANSACTION_CATEGORIES } from "../../finance/categories.js";
    import { categorySource, suggestCategories, type CategorySuggestion } from "../../finance/category-suggestions.js";
    import { formatMoney } from "@hearthlog/sdk/format";
    import { CommandDrawer } from "@hearthlog/sdk/ui";
    import { DataPlaceholder } from "@hearthlog/sdk/ui";
    import { Button } from "@hearthlog/sdk/ui";
    import { Select, type SelectOption } from "@hearthlog/sdk/ui";
    import { format, parseISO } from "date-fns";
    import { ChoiceChips } from "@hearthlog/sdk/ui";

    /** One row's new category and what it replaces, so the action can be undone. */
    export interface CategoryChange {
        id: string;
        category: string;
        source: string;
        previous: { category: string; source: string };
    }

    interface Entry {
        id: string;
        name: string;
        date: string;
        amount: number;
        previous: { category: string; source: string };
        choice: string;
        source: string;
        ticked: boolean;
        applied: CategorySuggestion | null;
        offered: CategorySuggestion | null;
    }

    let {
        show,
        month,
        onClose,
        onApply,
    }: {
        show: boolean;
        /** The `yyyy-MM` month to sort. */
        month: string;
        onClose: () => void;
        /** Writes every change in one action. Throws when saving fails. */
        onApply: (changes: CategoryChange[]) => Promise<void>;
    } = $props();

    const options: SelectOption[] = TRANSACTION_CATEGORIES.map(({ value, label }) => ({ value, label: value === "unknown" ? "Choose" : label }));

    let entries = $state<Entry[]>([]);
    let loading = $state(false);
    let busy = $state(false);
    let errorMessage = $state("");
    let run = 0;

    const monthLabel = $derived(month ? format(parseISO(`${month}-01`), "MMMM yyyy") : "");
    const ticked = $derived(entries.filter((entry) => entry.ticked));

    // Phones: the suggestion is the chosen chip, the next likely ones beside it, … for every category.
    // The phone form layout is the form layout at every width (docs/design-concepts/desktop-backport-2026-10-05).
    const phone = { current: true };
    let fullList = $state<Set<string>>(new Set());
    const COMMON = { expense: ["food", "shopping", "transport", "leisure", "housing"], income: ["income", "gifts", "other"] };
    function chipsFor(entry: Entry): { value: string; label: string }[] {
        const values = [entry.choice, entry.offered?.category ?? "", ...COMMON[entry.amount >= 0 ? "income" : "expense"]]
            .filter((value, index, all) => value && value !== "unknown" && all.indexOf(value) === index)
            .slice(0, 3);
        return values.map((value) => ({ value, label: categoryLabel(value) }));
    }
    function tapChip(entry: Entry, value: string): void {
        if (entry.choice === value) {
            // Tapping the chosen chip leaves this row out of Apply.
            entry.choice = "unknown";
            entry.ticked = false;
            entry.applied = null;
            return;
        }
        if (entry.offered?.category === value) takeOffer(entry);
        else choose(entry, value);
    }

    $effect(() => {
        if (!show) {
            run += 1;
            return;
        }
        void load(month);
    });

    async function load(key: string): Promise<void> {
        const current = ++run;
        loading = true;
        errorMessage = "";
        entries = [];
        try {
            const { start, end } = monthWindow(key);
            const rows = await queryDatabase((repositories) => repositories.transactions.getUncategorizedInMonth(start, end));
            if (current !== run) return;
            const suggestions = await suggestCategories(rows.map((row) => ({
                id: row.id,
                name: row.name ?? "",
                amount: Math.abs(row.amount),
                direction: row.amount >= 0 ? "income" as const : "expense" as const,
            })));
            // The sheet may have closed or moved to another month while the model was thinking.
            if (current !== run) return;
            entries = rows.map((row) => {
                const suggestion = suggestions.get(row.id);
                const apply = suggestion && !(suggestion.origin.kind === "ai" && suggestion.origin.band === "offer");
                return {
                    id: row.id,
                    name: row.name ?? "",
                    date: row.due_date?.slice(0, 10) ?? "",
                    amount: row.amount,
                    previous: { category: row.transaction_category || "unknown", source: row.category_source ?? "" },
                    choice: apply ? suggestion.category : "unknown",
                    source: apply ? categorySource(suggestion.origin) : "",
                    ticked: !!apply,
                    applied: apply ? suggestion : null,
                    offered: suggestion && !apply ? suggestion : null,
                };
            });
        } catch (error) {
            if (current !== run) return;
            console.error("[Finance] Could not load uncategorized transactions:", error);
            errorMessage = "The transactions could not be loaded.";
        } finally {
            if (current === run) loading = false;
        }
    }

    function choose(entry: Entry, value: string): void {
        entry.choice = value;
        entry.source = value === "unknown" ? "" : "manual";
        entry.ticked = value !== "unknown";
        entry.applied = null;
        entry.offered = null;
    }

    function takeOffer(entry: Entry): void {
        const offer = entry.offered;
        if (!offer) return;
        entry.choice = offer.category;
        entry.source = categorySource(offer.origin);
        entry.applied = offer;
        entry.offered = null;
        entry.ticked = true;
    }

    async function apply(): Promise<void> {
        if (busy || ticked.length === 0) return;
        busy = true;
        errorMessage = "";
        try {
            await onApply(ticked.map((entry) => ({ id: entry.id, category: entry.choice, source: entry.source, previous: entry.previous })));
        } catch {
            // The ticks stay, so the same Apply can be retried.
            errorMessage = "The categories could not be saved. Your choices are still here.";
        } finally {
            busy = false;
        }
    }
</script>

<CommandDrawer {show} title="Sort uncategorized" description={monthLabel} size="lg" onClose={() => { if (!busy) onClose(); }}>
    {#if loading}
        <DataPlaceholder rows={6} label="Finding categories" />
    {:else if entries.length === 0}
        <p class="text-sm text-[var(--stor-muted-text)]">{errorMessage || "Everything this month has a category."}</p>
    {:else}
        <ul class="divide-y divide-[var(--stor-border)]" aria-label="Uncategorized transactions">
            {#each entries as entry (entry.id)}
                <li class="flex flex-col gap-2 py-3">
                    <div class="flex items-baseline justify-between gap-3">
                        <span class="truncate text-[15px] font-medium text-[var(--stor-ink)]">{entry.name || "Untitled"}</span>
                        <span class="shrink-0 text-xs tabular-nums text-[var(--stor-muted-text)]">{format(parseISO(entry.date || `${month}-01`), "d MMM")} · {formatMoney(entry.amount)}</span>
                    </div>
                    {#if fullList.has(entry.id)}
                        <Select value={entry.choice} {options} disabled={busy} ariaLabel={`Category for ${entry.name || "transaction"}`} onValueChange={(value) => choose(entry, value)} />
                    {:else}
                        <ChoiceChips label={`Category for ${entry.name || "transaction"}`} options={chipsFor(entry)} value={entry.choice} onChange={(value) => tapChip(entry, value)} more="All" onMore={() => (fullList = new Set([...fullList, entry.id]))} />
                    {/if}
                </li>
            {/each}
        </ul>
        {#if errorMessage}
            <div class="mt-3 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">{errorMessage}</div>
        {/if}
    {/if}

    {#snippet footer()}
        <Button variant="secondary" size="sm" onclick={onClose} disabled={busy}>Cancel</Button>
        <Button data-testid="apply-categories" disabled={busy || ticked.length === 0} onclick={() => void apply()}>
            {busy ? "Saving..." : ticked.length === 0 ? "Apply" : phone.current ? `Apply ${ticked.length} ${ticked.length === 1 ? "category" : "categories"}` : `Apply ${ticked.length}`}
        </Button>
    {/snippet}
</CommandDrawer>
