<script lang="ts">
    import { formatAmount, formatMoney } from "@hearthlog/sdk/format";
    import { goto } from "$app/navigation";
    import { page } from "$app/state";
    import { DropdownMenu } from "bits-ui";
    import type { BudgetItem } from "@hearthlog/sdk/data";
    import type { BudgetItemSelectionSummary, BudgetItemSort, BudgetPlanSummary } from "../../data/budgets.js";
    import { queryDatabase } from "@hearthlog/sdk/data";
    import type { AppEvent } from "@hearthlog/sdk/data";
    import { budgetItemCommands, budgetPlanCommands } from "@hearthlog/sdk/data";
    import { executeLocalCommand } from "@hearthlog/sdk/data";
    import { refreshPageData } from "@hearthlog/sdk/runtime";
    import { contextualHref } from "@hearthlog/sdk/runtime";
    import { notify } from "@hearthlog/sdk/runtime";
    import { Button } from "@hearthlog/sdk/ui";
    import { Select, type SelectOption } from "@hearthlog/sdk/ui";
    import { CommandOnly } from "@hearthlog/sdk/ui";
    import { CommandConfirmDialog } from "@hearthlog/sdk/ui";
    import { MobilePageAction } from "@hearthlog/sdk/ui";
    import { PhoneGlance } from "@hearthlog/sdk/ui";
    import BudgetPlanDrawer from "./BudgetPlanDrawer.svelte";
    import BudgetItemDrawer, { type BudgetItemDraft } from "./BudgetItemDrawer.svelte";
    import BudgetItemsTable from "./BudgetItemsTable.svelte";
    import IconPlus from "~icons/mdi/plus";
    import IconDots from "~icons/mdi/dots-horizontal";
    import IconPencil from "~icons/mdi/pencil-outline";
    import IconContentCopy from "~icons/mdi/content-copy";
    import IconDelete from "~icons/mdi/delete-outline";

    let { plans, incomeItems, expenseItems, selectedPlanId, incomeSort, expenseSort } = $props<{
        plans: BudgetPlanSummary[];
        incomeItems: BudgetItem[];
        expenseItems: BudgetItem[];
        selectedPlanId: string | null;
        incomeSort: BudgetItemSort | null;
        expenseSort: BudgetItemSort | null;
    }>();

    const selectedPlan = $derived(plans.find((plan: BudgetPlanSummary) => plan.id === selectedPlanId) ?? plans[0] ?? null);
    const planOptions = $derived<SelectOption[]>(plans.map((plan: BudgetPlanSummary) => ({ value: plan.id, label: plan.name })));
    const remaining = $derived((selectedPlan?.income_total ?? 0) - (selectedPlan?.expense_total ?? 0));
    const moneyFormatter = { format: (value: number) => formatMoney(value) };

    type PlanDrawerMode = "create" | "rename" | "duplicate";
    let planDrawerMode = $state<PlanDrawerMode | null>(null);
    let itemDrawerOpen = $state(false);
    let itemDrawerType = $state<"income" | "expense">("expense");
    let editingItem = $state<BudgetItem | null>(null);
    let pendingDeletePlan = $state(false);
    let pendingDeleteItem = $state<BudgetItem | null>(null);

    // --- Selection: row and section checkboxes feed one id set across both tables ---
    let selectedIds = $state(new Set<string>());
    let batchBusy = $state(false);
    let confirmDeleteSelectedOpen = $state(false);
    const emptySelectionSummary: BudgetItemSelectionSummary = {
        count: 0,
        incomeTotal: 0,
        expenseTotal: 0,
        netTotal: 0,
    };
    let selectionSummary = $state<BudgetItemSelectionSummary>({ ...emptySelectionSummary });
    let selectionSummaryLoading = $state(false);

    const allItems = $derived([...incomeItems, ...expenseItems]);
    const itemById = $derived(new Map(allItems.map((item) => [item.id, item])));
    // Ids that outlived their rows (a refresh removed them) simply drop out here.
    const selectedItems = $derived(
        [...selectedIds].flatMap((id) => {
            const row = itemById.get(id);
            return row ? [row] : [];
        }),
    );
    const selectionCount = $derived(selectedItems.length);
    const allVisibleSelected = $derived(
        allItems.length > 0 && allItems.every((item) => selectedIds.has(item.id)),
    );
    const deleteSelectedTitle = $derived(
        selectionCount === 1 ? "Delete planned item?" : `Delete ${selectionCount} planned items?`,
    );
    const deleteSelectedMessage = $derived.by(() => {
        const names = selectedItems.map((item) => item.name);
        if (names.length === 1) return `This removes ${names[0]} from the plan.`;
        return `This removes these ${names.length} items: ${names.slice(0, 10).join(", ")}${names.length > 10 ? ", …" : ""}.`;
    });
    // A primitive so data refreshes (new object identities) never drop the
    // selection; only switching plans replaces every visible row.
    const activePlanId = $derived(selectedPlan?.id ?? "");

    $effect(() => {
        void activePlanId;
        selectedIds = new Set();
    });

    // Totals are a separate SQL query so ticking a checkbox never re-scans rows.
    $effect(() => {
        const ids = selectedItems.map((item) => item.id);
        if (ids.length === 0) {
            selectionSummary = { ...emptySelectionSummary };
            selectionSummaryLoading = false;
            return;
        }
        let cancelled = false;
        selectionSummaryLoading = true;
        queryDatabase((repositories) => repositories.budgets.getSelectionSummary(ids))
            .then((result) => {
                if (!cancelled) selectionSummary = result;
            })
            .catch(() => {
                if (!cancelled) selectionSummary = { ...emptySelectionSummary };
            })
            .finally(() => {
                if (!cancelled) selectionSummaryLoading = false;
            });
        return () => {
            cancelled = true;
        };
    });

    function setSelected(items: BudgetItem[], selected: boolean) {
        const next = new Set(selectedIds);
        for (const item of items) {
            if (selected) next.add(item.id);
            else next.delete(item.id);
        }
        selectedIds = next;
    }

    function clearSelection() {
        selectedIds = new Set();
    }

    function selectAllVisible() {
        setSelected(allItems, true);
    }

    function requestDeleteSelected() {
        if (selectionCount === 0) return;
        confirmDeleteSelectedOpen = true;
    }

    async function deleteSelected() {
        confirmDeleteSelectedOpen = false;
        const targets = selectedItems;
        if (batchBusy || targets.length === 0) return;
        batchBusy = true;
        try {
            const count = targets.length;
            // One submission identity per batch: retrying stays idempotent.
            await executeLocalCommand(
                targets.map((item) => ({
                    id: crypto.randomUUID(),
                    type: "BUDGET_ITEM_REMOVED" as const,
                    timestamp: Date.now(),
                    payload: { id: item.id },
                })),
                { submissionId: crypto.randomUUID() },
            );
            await refreshPageData("app:budgets");
            notify.success(`${count} planned item${count === 1 ? "" : "s"} deleted`);
            clearSelection();
        } catch (error) {
            console.error("[Finance] Failed to delete budget items:", error);
            notify.error("Could not delete the selected items");
        } finally {
            batchBusy = false;
        }
    }

    const planDrawerCopy = $derived.by(() => {
        if (planDrawerMode === "rename") return { title: "Rename plan", description: "Update the name of this plan.", action: "Save name", name: selectedPlan?.name ?? "" };
        if (planDrawerMode === "duplicate") return { title: "Duplicate plan", description: "Copy every planned item into an independent scenario.", action: "Duplicate plan", name: selectedPlan ? `${selectedPlan.name} copy` : "" };
        return { title: "New budget plan", description: "Create an independent planning scenario.", action: "Create plan", name: plans.length === 0 ? "Baseline" : "" };
    });

    /** One budget URL, so plan and both section sorts can never drift apart. */
    function budgetHref(planId: string | null, sorts: { incomeSort?: BudgetItemSort | null; expenseSort?: BudgetItemSort | null } = {}): string {
        const params = new URLSearchParams({ tab: "budget" });
        if (planId) params.set("plan", planId);
        const nextIncomeSort = sorts.incomeSort !== undefined ? sorts.incomeSort : incomeSort;
        const nextExpenseSort = sorts.expenseSort !== undefined ? sorts.expenseSort : expenseSort;
        if (nextIncomeSort) params.set("incomeSort", nextIncomeSort);
        if (nextExpenseSort) params.set("expenseSort", nextExpenseSort);
        return contextualHref(`${page.url.pathname}?${params.toString()}`);
    }

    function selectPlan(planId: string) {
        void goto(budgetHref(planId), { reset: false });
    }

    function changeSort(type: "income" | "expense", next: BudgetItemSort | null) {
        if (!selectedPlan) return;
        const href = type === "income" ? budgetHref(selectedPlan.id, { incomeSort: next }) : budgetHref(selectedPlan.id, { expenseSort: next });
        void goto(href, { reset: false, replace: true });
    }

    function openItem(type: "income" | "expense", item: BudgetItem | null = null) {
        itemDrawerType = type;
        editingItem = item;
        itemDrawerOpen = true;
    }

    // Phones: a new plan starts from the current one, its name a year on when it ends in one.
    // The phone form layout is the form layout at every width (docs/design-concepts/desktop-backport-2026-10-05).
    const phone = { current: true };
    function nextPlanName(name: string): string {
        const match = name.match(/^(.*?)(\d{4})$/);
        return match ? `${match[1]}${Number(match[2]) + 1}` : `${name} copy`;
    }

    async function savePlan(name: string, copy = false) {
        if (planDrawerMode === "rename" && selectedPlan) {
            await budgetPlanCommands.update({ id: selectedPlan.id, name });
            await refreshPageData("app:budgets");
            notify.success("Plan renamed");
            planDrawerMode = null;
            return;
        }

        const mode = copy ? "duplicate" : planDrawerMode;
        const planId = crypto.randomUUID();
        const events: AppEvent[] = [{
            id: crypto.randomUUID(), type: "BUDGET_PLAN_ADDED", timestamp: Date.now(),
            payload: { id: planId, name },
        }];
        if (mode === "duplicate" && selectedPlan) {
            for (const item of [...incomeItems, ...expenseItems]) {
                events.push({
                    id: crypto.randomUUID(), type: "BUDGET_ITEM_ADDED", timestamp: Date.now(),
                    payload: { id: crypto.randomUUID(), planId, name: item.name, amount: item.amount, itemType: item.item_type, category: item.category },
                });
            }
        }
        await executeLocalCommand(events, { submissionId: crypto.randomUUID() });
        planDrawerMode = null;
        notify.success(mode === "duplicate" ? "Plan duplicated" : "Plan created");
        await goto(budgetHref(planId));
    }

    async function saveItem(draft: BudgetItemDraft, addAnother: boolean) {
        if (!selectedPlan) return;
        if (draft.id) {
            await budgetItemCommands.update({ id: draft.id, name: draft.name, amount: draft.amount, itemType: draft.itemType, category: draft.category });
            notify.success("Planned item updated");
        } else {
            await budgetItemCommands.create({ id: crypto.randomUUID(), planId: selectedPlan.id, name: draft.name, amount: draft.amount, itemType: draft.itemType, category: draft.category });
            notify.success(draft.itemType === "income" ? "Planned income added" : "Planned expense added");
        }
        await refreshPageData("app:budgets");
        if (!addAnother) itemDrawerOpen = false;
    }

    async function deleteItem() {
        const item = pendingDeleteItem;
        if (!item) return;
        pendingDeleteItem = null;
        await budgetItemCommands.remove({ id: item.id });
        await refreshPageData("app:budgets");
        notify.success("Planned item deleted");
    }

    async function deletePlan() {
        if (!selectedPlan) return;
        const events: AppEvent[] = [
            ...[...incomeItems, ...expenseItems].map((item) => ({ id: crypto.randomUUID(), type: "BUDGET_ITEM_REMOVED" as const, timestamp: Date.now(), payload: { id: item.id } })),
            { id: crypto.randomUUID(), type: "BUDGET_PLAN_REMOVED", timestamp: Date.now(), payload: { id: selectedPlan.id } },
        ];
        pendingDeletePlan = false;
        await executeLocalCommand(events, { submissionId: crypto.randomUUID() });
        notify.success("Plan deleted");
        await goto(budgetHref(null));
    }

    const menuItemClass = "flex min-h-10 w-full cursor-default items-center gap-2 px-3 py-2 text-sm text-stone-700 outline-none data-[highlighted]:bg-[var(--stor-surface-muted)] data-[highlighted]:text-stone-950";
</script>

{#if plans.length === 0}
    <section class="stor-panel mx-2.5 mt-3 flex min-h-80 flex-col items-center justify-center px-6 py-12 text-center sm:mx-3">
        <div class="flex h-12 w-12 items-center justify-center rounded-2xl bg-[var(--stor-accent-soft)] text-2xl font-semibold text-[var(--stor-accent-strong)]">+</div>
        <h2 class="mt-4 text-lg font-semibold text-[var(--stor-ink)]">Plan your budget</h2>
        <p class="mt-2 max-w-md text-sm leading-6 text-[var(--stor-muted-text)]">Create a scenario for expected income and expenses. Plans stay separate from your transactions and apply to every month.</p>
        <CommandOnly><Button class="mt-5" onclick={() => planDrawerMode = "create"}><IconPlus class="h-4 w-4" /> Create first plan</Button></CommandOnly>
    </section>
{:else if selectedPlan}
    <div class="min-h-0 flex-1 overflow-y-auto p-2.5 pb-24 sm:p-3 lg:pb-3">
        <div class="mx-auto max-w-6xl space-y-3">
            <div class="flex flex-wrap items-center justify-between gap-2 max-md:hidden">
                <div class="flex min-w-0 flex-1 items-center gap-2">
                    <Select class="w-full max-w-64" value={selectedPlan.id} options={planOptions} ariaLabel="Selected budget plan" onValueChange={selectPlan} />
                    <span class="hidden text-xs text-[var(--stor-muted-text)] sm:inline">{plans.length} {plans.length === 1 ? "plan" : "plans"} · Saved</span>
                    <CommandOnly><DropdownMenu.Root>
                        <DropdownMenu.Trigger class="flex h-11 w-11 items-center justify-center rounded-xl text-[var(--stor-muted-text)] hover:bg-[var(--stor-accent-soft)] hover:text-[var(--stor-accent-strong)] sm:h-9 sm:w-9" aria-label="Plan actions"><IconDots class="h-5 w-5" /></DropdownMenu.Trigger>
                        <DropdownMenu.Portal><DropdownMenu.Content sideOffset={6} align="start" class="stor-menu z-[var(--stor-layer-menu)] min-w-48 overflow-hidden py-1">
                            <DropdownMenu.Item class={menuItemClass} onSelect={() => planDrawerMode = "rename"}><IconPencil class="h-4 w-4" /> Rename</DropdownMenu.Item>
                            <DropdownMenu.Item class={menuItemClass} onSelect={() => planDrawerMode = "duplicate"}><IconContentCopy class="h-4 w-4" /> Duplicate plan</DropdownMenu.Item>
                            <DropdownMenu.Separator class="my-1 h-px bg-[var(--stor-border)]" />
                            <DropdownMenu.Item class={`${menuItemClass} text-[var(--stor-negative)]`} onSelect={() => pendingDeletePlan = true}><IconDelete class="h-4 w-4" /> Delete plan</DropdownMenu.Item>
                        </DropdownMenu.Content></DropdownMenu.Portal>
                    </DropdownMenu.Root></CommandOnly>
                </div>
                <CommandOnly><Button variant="secondary" onclick={() => planDrawerMode = "create"}><IconPlus class="h-4 w-4" /> New plan</Button></CommandOnly>
            </div>

            {#snippet summary(sheet: boolean)}
            <section class="stor-today-card grid grid-cols-2 gap-4 p-[var(--stor-panel-padding)] lg:grid-cols-3 lg:gap-8 {sheet ? '' : 'max-md:hidden'}" aria-label="Budget summary">
                <div class="min-w-0"><p class="text-xs font-medium text-[var(--stor-muted-text)]">Planned income</p><p class="mt-2 break-words text-lg font-semibold tabular-nums text-[var(--stor-positive)] sm:text-xl lg:text-2xl">{moneyFormatter.format(selectedPlan.income_total)}</p></div>
                <div class="min-w-0"><p class="text-xs font-medium text-[var(--stor-muted-text)]">Planned expenses</p><p class="mt-2 break-words text-lg font-semibold tabular-nums text-[var(--stor-ink)] sm:text-xl lg:text-2xl">{moneyFormatter.format(selectedPlan.expense_total)}</p></div>
                <div class="col-span-2 min-w-0 border-t border-[var(--stor-border)] pt-4 lg:col-span-1 lg:border-l lg:border-t-0 lg:pl-8 lg:pt-0"><p class="text-xs font-medium text-[var(--stor-muted-text)]">Remaining</p><p class="mt-2 break-words text-xl font-semibold tabular-nums sm:text-2xl {remaining > 0 ? 'text-[var(--stor-positive)]' : 'text-[var(--stor-ink)]'}">{remaining > 0 ? "+" : ""}{moneyFormatter.format(remaining)}</p><p class="mt-1 text-xs text-[var(--stor-muted-text)]">Income minus expenses</p></div>
            </section>
            {/snippet}
            {@render summary(false)}
            <PhoneGlance label="Remaining" value={`${remaining > 0 ? "+" : ""}${formatAmount(remaining)}`} unit="Kč" tone={remaining > 0 ? "positive" : "default"} title={selectedPlan.name}>
                {@render summary(true)}
            </PhoneGlance>

            <!-- style:overflow="visible" keeps the sticky selection bar working, as on the invoice list. -->
            <section class="stor-panel" style:overflow="visible">
                <!-- Phones pick the plan where its items start; New plan, Rename, Duplicate and Delete sit in its menu. -->
                <div class="flex h-12 items-center gap-1.5 border-b border-[color-mix(in_srgb,var(--stor-border)_62%,transparent)] pl-2 pr-1 md:hidden">
                    <Select class="min-w-0 flex-1" value={selectedPlan.id} options={planOptions} ariaLabel="Selected budget plan" onValueChange={selectPlan} />
                    <CommandOnly><DropdownMenu.Root>
                        <DropdownMenu.Trigger class="flex h-11 w-11 items-center justify-center rounded-xl text-[var(--stor-muted-text)]" aria-label="Plan actions"><IconDots class="h-5 w-5" /></DropdownMenu.Trigger>
                        <DropdownMenu.Portal><DropdownMenu.Content sideOffset={6} align="end" class="stor-menu z-[var(--stor-layer-menu)] min-w-48 overflow-hidden py-1">
                            <DropdownMenu.Item class={menuItemClass} onSelect={() => planDrawerMode = "create"}><IconPlus class="h-4 w-4" /> New plan</DropdownMenu.Item>
                            <DropdownMenu.Item class={menuItemClass} onSelect={() => planDrawerMode = "rename"}><IconPencil class="h-4 w-4" /> Rename</DropdownMenu.Item>
                            <DropdownMenu.Separator class="my-1 h-px bg-[var(--stor-border)]" />
                            <DropdownMenu.Item class={`${menuItemClass} text-[var(--stor-negative)]`} onSelect={() => pendingDeletePlan = true}><IconDelete class="h-4 w-4" /> Delete plan</DropdownMenu.Item>
                        </DropdownMenu.Content></DropdownMenu.Portal>
                    </DropdownMenu.Root></CommandOnly>
                </div>
                <div class="flex items-center justify-between gap-3 px-4 py-3.5 max-md:hidden"><div><h2 class="font-semibold text-[var(--stor-ink)]">{selectedPlan.name}</h2><p class="text-xs text-[var(--stor-muted-text)]">{selectedPlan.item_count} {selectedPlan.item_count === 1 ? "item" : "items"}</p></div><CommandOnly><Button class="hidden sm:inline-flex" onclick={() => openItem("expense")}><IconPlus class="h-4 w-4" /> Add item</Button></CommandOnly></div>
                {#if selectionCount > 0}
                    <div class="flex flex-wrap items-center gap-x-3 gap-y-1 bg-[var(--stor-surface-muted)] px-4 py-2 text-xs text-[var(--stor-muted-text)]" role="status">
                        {#if allVisibleSelected}
                            <span>All {selectionCount} item{selectionCount === 1 ? "" : "s"} in this view {selectionCount === 1 ? "is" : "are"} selected.</span>
                            <button type="button" onclick={clearSelection} class="font-semibold text-[var(--stor-accent-strong)] hover:underline">Clear selection</button>
                        {:else}
                            <span>{selectionCount} of {allItems.length} item{allItems.length === 1 ? "" : "s"} in this view {selectionCount === 1 ? "is" : "are"} selected.</span>
                            <button type="button" onclick={selectAllVisible} class="font-semibold text-[var(--stor-accent-strong)] hover:underline">Select all {allItems.length}</button>
                        {/if}
                    </div>
                    <div class="sticky top-0 z-10 hidden flex-wrap items-center gap-x-6 gap-y-2 bg-[var(--stor-accent-soft)] px-4 py-3 text-sm lg:flex" aria-label="Selected item totals">
                        <strong>{selectionCount} selected</strong>
                        {#if selectionSummaryLoading}
                            <span class="text-[var(--stor-muted-text)]">Calculating totals…</span>
                        {:else}
                            <div><span class="text-[var(--stor-muted-text)]">Income</span> <strong class="ml-1 tabular-nums">+{moneyFormatter.format(selectionSummary.incomeTotal)}</strong></div>
                            <div><span class="text-[var(--stor-muted-text)]">Expenses</span> <strong class="ml-1 tabular-nums">{moneyFormatter.format(-selectionSummary.expenseTotal)}</strong></div>
                            <div><span class="text-[var(--stor-muted-text)]">Net</span> <strong class="ml-1 tabular-nums">{moneyFormatter.format(selectionSummary.netTotal)}</strong></div>
                        {/if}
                        <div class="ml-auto flex items-center gap-2">
                            <CommandOnly><button type="button" disabled={batchBusy} onclick={requestDeleteSelected} class="h-9 rounded-lg px-3 font-semibold text-[var(--stor-negative)] disabled:opacity-50">Delete</button></CommandOnly>
                            <button type="button" onclick={clearSelection} class="h-9 px-2 text-[var(--stor-accent-strong)]">Clear selection</button>
                        </div>
                    </div>
                {/if}
                <BudgetItemsTable
                    type="income"
                    label="Income"
                    total={selectedPlan.income_total}
                    items={incomeItems}
                    sort={incomeSort}
                    selectedIds={selectedIds}
                    onSelectionChange={setSelected}
                    onAdd={() => openItem("income")}
                    onEdit={(item) => openItem("income", item)}
                    onDelete={(item) => (pendingDeleteItem = item)}
                    onSortChange={(next) => changeSort("income", next)}
                />
                <BudgetItemsTable
                    type="expense"
                    label="Expenses"
                    total={selectedPlan.expense_total}
                    items={expenseItems}
                    sort={expenseSort}
                    selectedIds={selectedIds}
                    onSelectionChange={setSelected}
                    onAdd={() => openItem("expense")}
                    onEdit={(item) => openItem("expense", item)}
                    onDelete={(item) => (pendingDeleteItem = item)}
                    onSortChange={(next) => changeSort("expense", next)}
                />
                <p class="border-t border-[var(--stor-border)] px-4 py-3 text-xs text-[var(--stor-muted-text)]">Plans do not create transactions.</p>
            </section>
            {#if selectionCount > 0}<div class="h-60 lg:hidden" aria-hidden="true"></div>{/if}
        </div>
    </div>
    {#if selectionCount > 0}
        <div class="fixed inset-x-2 bottom-20 z-30 rounded-xl bg-[var(--stor-surface)] p-3 shadow-[var(--stor-elevation-3)] lg:hidden" aria-label="Selected item totals">
            <div class="flex items-center justify-between gap-2">
                <strong>{selectionCount} selected</strong>
                <div class="flex items-center gap-3 text-sm">
                    {#if !allVisibleSelected}<button type="button" onclick={selectAllVisible} class="text-[var(--stor-accent-strong)]">Select all {allItems.length}</button>{/if}
                    <button type="button" onclick={clearSelection} class="text-[var(--stor-accent-strong)]">Clear</button>
                </div>
            </div>
            {#if selectionSummaryLoading}
                <span class="mt-2 block text-sm text-[var(--stor-muted-text)]">Calculating totals…</span>
            {:else}
                <div class="mt-2 grid grid-cols-3 gap-2 text-sm">
                    <div><span class="block text-xs text-[var(--stor-muted-text)]">Income</span><strong class="tabular-nums">+{moneyFormatter.format(selectionSummary.incomeTotal)}</strong></div>
                    <div><span class="block text-xs text-[var(--stor-muted-text)]">Expenses</span><strong class="tabular-nums">{moneyFormatter.format(-selectionSummary.expenseTotal)}</strong></div>
                    <div><span class="block text-xs text-[var(--stor-muted-text)]">Net</span><strong class="tabular-nums">{moneyFormatter.format(selectionSummary.netTotal)}</strong></div>
                </div>
            {/if}
            <CommandOnly><button type="button" disabled={batchBusy} onclick={requestDeleteSelected} class="mt-3 h-11 w-full rounded-lg bg-[var(--stor-negative-soft)] font-semibold text-[var(--stor-negative)] disabled:opacity-50">Delete</button></CommandOnly>
        </div>
    {/if}
    <MobilePageAction hideWhenModalOpen hidden={selectionCount > 0} isModalOpen={itemDrawerOpen || planDrawerMode !== null || pendingDeletePlan || pendingDeleteItem !== null || confirmDeleteSelectedOpen}><CommandOnly><Button class="h-12 w-full text-[15px]" onclick={() => openItem("expense")} data-testid="open-budget-item-mobile"><IconPlus class="h-5 w-5" /> <span class="stor-action-label">Add item</span></Button></CommandOnly></MobilePageAction>
{/if}

<CommandOnly onUnavailable={() => { planDrawerMode = null; itemDrawerOpen = false; }}>
    <BudgetPlanDrawer show={planDrawerMode !== null} title={planDrawerCopy.title} description={planDrawerCopy.description} actionLabel={planDrawerCopy.action} initialName={planDrawerMode === "create" && phone.current && selectedPlan ? nextPlanName(selectedPlan.name) : planDrawerCopy.name} onClose={() => planDrawerMode = null} onSave={savePlan}
        startFrom={planDrawerMode === "create" && phone.current && selectedPlan ? { label: selectedPlan.name, detail: `Copies ${selectedPlan.item_count} ${selectedPlan.item_count === 1 ? "item" : "items"} · ${moneyFormatter.format(selectedPlan.income_total)} in, ${moneyFormatter.format(selectedPlan.expense_total)} out` } : undefined} />
    {#if selectedPlan}<BudgetItemDrawer show={itemDrawerOpen} planName={selectedPlan.name} initialItem={editingItem} initialType={itemDrawerType} onClose={() => itemDrawerOpen = false} onSave={saveItem} />{/if}
</CommandOnly>
<CommandConfirmDialog show={pendingDeletePlan} title={`Delete ${selectedPlan?.name ?? "this plan"}?`} message={`This removes the plan and its ${selectedPlan?.item_count ?? 0} planned items.`} confirmLabel="Delete plan" onConfirm={deletePlan} onCancel={() => pendingDeletePlan = false} />
<CommandConfirmDialog show={pendingDeleteItem !== null} title="Delete planned item?" message={`This removes ${pendingDeleteItem?.name ?? "the item"} from the plan.`} confirmLabel="Delete item" onConfirm={deleteItem} onCancel={() => pendingDeleteItem = null} />
<CommandConfirmDialog show={confirmDeleteSelectedOpen} title={deleteSelectedTitle} message={deleteSelectedMessage} confirmLabel={selectionCount === 1 ? "Delete item" : "Delete items"} onConfirm={deleteSelected} onCancel={() => confirmDeleteSelectedOpen = false} />
