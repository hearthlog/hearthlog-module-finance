<script lang="ts">
    import { formatAmount, formatMoney } from "@hearthlog/sdk/format";
    import { goto } from "$app/navigation";
    import { page } from "$app/state";
    import { DropdownMenu } from "bits-ui";
    import type { AppEvent, BudgetItem, RemoveTransactionEvent } from "@hearthlog/sdk/data";
    import type { BudgetItemSelectionSummary, BudgetItemSort, BudgetPlanSummary } from "../../data/budgets.js";
    import type { CategoryActuals } from "../../data/finance-timeline.js";
    import { budgetItemCommands, budgetPlanCommands, executeLocalCommand, queryDatabase } from "@hearthlog/sdk/data";
    import { contextualHref, notify, refreshPageData } from "@hearthlog/sdk/runtime";
    import { Button, CommandConfirmDialog, CommandOnly, MobilePageAction, PhoneGlance, Select, type SelectOption } from "@hearthlog/sdk/ui";
    import BudgetPlanDrawer from "./BudgetPlanDrawer.svelte";
    import BudgetItemDrawer, { type BudgetItemDraft } from "./BudgetItemDrawer.svelte";
    import RecurringRuleDrawer from "./RecurringRuleDrawer.svelte";
    import { categoryLabel } from "../../finance/categories.js";
    import { categoryIcon } from "../../finance/category-icons.js";
    import {
        buildRecurringEvents,
        formatRecurringRule,
        loadActiveBudgetPlanId,
        loadRecurringRules,
        occurrenceKey,
        saveActiveBudgetPlanId,
        saveRecurringRules,
        type RecurringRule,
        type RecurringRuleMap,
    } from "../../finance/recurring.js";
    import IconPlus from "~icons/mdi/plus";
    import IconDots from "~icons/mdi/dots-horizontal";
    import IconPencil from "~icons/mdi/pencil-outline";
    import IconContentCopy from "~icons/mdi/content-copy";
    import IconDelete from "~icons/mdi/delete-outline";
    import IconRepeat from "~icons/mdi/repeat";

    let {
        plans,
        incomeItems,
        expenseItems,
        selectedPlanId,
        incomeSort,
        expenseSort,
        today = "",
        categoryActuals = {},
    }: {
        plans: BudgetPlanSummary[];
        incomeItems: BudgetItem[];
        expenseItems: BudgetItem[];
        selectedPlanId: string | null;
        incomeSort: BudgetItemSort | null;
        expenseSort: BudgetItemSort | null;
        today?: string;
        categoryActuals?: CategoryActuals;
    } = $props();

    const selectedPlan = $derived(plans.find((plan: BudgetPlanSummary) => plan.id === selectedPlanId) ?? plans[0] ?? null);
    const planOptions = $derived<SelectOption[]>(plans.map((plan: BudgetPlanSummary) => ({ value: plan.id, label: plan.name })));
    const remaining = $derived((selectedPlan?.income_total ?? 0) - (selectedPlan?.expense_total ?? 0));
    const savingsRate = $derived(
        (selectedPlan?.income_total ?? 0) > 0
            ? Math.round((remaining / (selectedPlan?.income_total ?? 1)) * 1000) / 10
            : 0,
    );
    const moneyFormatter = { format: (value: number) => formatMoney(value) };

    // --- Recurring rules & active timeline plan ---
    let recurringRules = $state<RecurringRuleMap>({});
    let activeTimelinePlanId = $state<string | null>(null);
    let ruleDrawerItem = $state<BudgetItem | null>(null);

    $effect(() => {
        void loadRecurringRules().then((loaded) => { recurringRules = loaded; });
        void loadActiveBudgetPlanId().then((id) => { activeTimelinePlanId = id; });
    });

    const effectiveActivePlanId = $derived(activeTimelinePlanId ?? plans[0]?.id ?? null);
    const allItems = $derived([...incomeItems, ...expenseItems]);
    const autoScheduledCount = $derived(allItems.filter((item) => recurringRules[item.id]?.enabled).length);

    async function setAsActivePlan(planId: string): Promise<void> {
        activeTimelinePlanId = planId;
        await saveActiveBudgetPlanId(planId).catch(() => undefined);
        notify.success("Set as active timeline scenario");
    }

    async function syncItemToTimeline(item: BudgetItem, rule: RecurringRule): Promise<number> {
        if (!rule.enabled || !today) return 0;
        const endDate = `${Number(today.slice(0, 4)) + 1}-12-31`;
        const existingRows = await queryDatabase((repositories) =>
            repositories.timeline.getRows({ today, start: today, end: endDate, show: "planned" }),
        );
        const existingKeys = new Set(existingRows.map((row) => occurrenceKey(row.name, row.date)));
        const events = buildRecurringEvents(item, rule, today, existingKeys, 3);
        if (events.length === 0) return 0;
        await executeLocalCommand(events, { submissionId: crypto.randomUUID() });
        await refreshPageData("app:transactions");
        const createdIds = events.map((event) => event.payload.id);
        notify.success(`Scheduled ${events.length} upcoming "${item.name}" ${events.length === 1 ? "row" : "rows"} on Cash Flow`, {
            label: "Undo",
            run: async () => {
                await executeLocalCommand(
                    createdIds.map((id) => ({
                        id: crypto.randomUUID(),
                        type: "TRANSACTION_REMOVED" as const,
                        timestamp: Date.now(),
                        payload: { id },
                    } satisfies RemoveTransactionEvent)),
                    { submissionId: crypto.randomUUID() },
                );
                await refreshPageData("app:transactions");
            },
        });
        return events.length;
    }

    async function saveRule(item: BudgetItem, nextRule: RecurringRule): Promise<void> {
        const nextMap: RecurringRuleMap = { ...recurringRules, [item.id]: nextRule };
        recurringRules = nextMap;
        await saveRecurringRules(nextMap).catch(() => notify.error("Could not save recurring rule on this device"));
        if (nextRule.enabled) {
            const added = await syncItemToTimeline(item, nextRule);
            if (added === 0) notify.success(`Recurring rule saved for "${item.name}"`);
        } else {
            notify.success(`"${item.name}" set to plan only`);
        }
    }

    async function toggleAutoSchedule(item: BudgetItem): Promise<void> {
        const current = recurringRules[item.id];
        const nextRule: RecurringRule = current
            ? { ...current, enabled: !current.enabled }
            : { enabled: true, cadence: "monthly", dayOfMonth: today ? Number(today.slice(8, 10)) || 1 : 1 };
        await saveRule(item, nextRule);
    }

    // --- Plan & item drawers ---
    type PlanDrawerMode = "create" | "rename" | "duplicate";
    let planDrawerMode = $state<PlanDrawerMode | null>(null);
    let itemDrawerOpen = $state(false);
    let itemDrawerType = $state<"income" | "expense">("expense");
    let editingItem = $state<BudgetItem | null>(null);
    let pendingDeletePlan = $state(false);
    let pendingDeleteItem = $state<BudgetItem | null>(null);

    // --- Selection ---
    let selectedIds = $state(new Set<string>());
    let batchBusy = $state(false);
    let confirmDeleteSelectedOpen = $state(false);
    const emptySelectionSummary: BudgetItemSelectionSummary = { count: 0, incomeTotal: 0, expenseTotal: 0, netTotal: 0 };
    let selectionSummary = $state<BudgetItemSelectionSummary>({ ...emptySelectionSummary });
    let selectionSummaryLoading = $state(false);

    const itemById = $derived(new Map(allItems.map((item) => [item.id, item])));
    const selectedItems = $derived(
        [...selectedIds].flatMap((id) => {
            const row = itemById.get(id);
            return row ? [row] : [];
        }),
    );
    const selectionCount = $derived(selectedItems.length);
    const allVisibleSelected = $derived(allItems.length > 0 && allItems.every((item) => selectedIds.has(item.id)));
    const deleteSelectedTitle = $derived(selectionCount === 1 ? "Delete planned item?" : `Delete ${selectionCount} planned items?`);
    const deleteSelectedMessage = $derived.by(() => {
        const names = selectedItems.map((item) => item.name);
        if (names.length === 1) return `This removes ${names[0]} from the plan.`;
        return `This removes these ${names.length} items: ${names.slice(0, 10).join(", ")}${names.length > 10 ? ", …" : ""}.`;
    });
    const activePlanId = $derived(selectedPlan?.id ?? "");

    $effect(() => {
        void activePlanId;
        selectedIds = new Set();
    });

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
            .then((result) => { if (!cancelled) selectionSummary = result; })
            .catch(() => { if (!cancelled) selectionSummary = { ...emptySelectionSummary }; })
            .finally(() => { if (!cancelled) selectionSummaryLoading = false; });
        return () => { cancelled = true; };
    });

    function setSelected(items: BudgetItem[], selected: boolean) {
        const next = new Set(selectedIds);
        for (const item of items) {
            if (selected) next.add(item.id);
            else next.delete(item.id);
        }
        selectedIds = next;
    }

    function clearSelection() { selectedIds = new Set(); }
    function selectAllVisible() { setSelected(allItems, true); }
    function requestDeleteSelected() { if (selectionCount > 0) confirmDeleteSelectedOpen = true; }

    async function deleteSelected() {
        confirmDeleteSelectedOpen = false;
        const targets = selectedItems;
        if (batchBusy || targets.length === 0) return;
        batchBusy = true;
        try {
            const count = targets.length;
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

    function budgetHref(planId: string | null, sorts: { incomeSort?: BudgetItemSort | null; expenseSort?: BudgetItemSort | null } = {}): string {
        const params = new URLSearchParams({ tab: "budget" });
        if (planId) params.set("plan", planId);
        const nextIncomeSort = sorts.incomeSort !== undefined ? sorts.incomeSort : incomeSort;
        const nextExpenseSort = sorts.expenseSort !== undefined ? sorts.expenseSort : expenseSort;
        if (nextIncomeSort) params.set("incomeSort", nextIncomeSort);
        if (nextExpenseSort) params.set("expenseSort", nextExpenseSort);
        return contextualHref(`${page.url.pathname}?${params.toString()}`);
    }

    function selectPlan(planId: string) { void goto(budgetHref(planId), { reset: false }); }

    function openItem(type: "income" | "expense", item: BudgetItem | null = null) {
        itemDrawerType = type;
        editingItem = item;
        itemDrawerOpen = true;
    }

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

    function actualFor(item: BudgetItem): number {
        const bucket = categoryActuals[item.category || "other"];
        if (!bucket) return 0;
        return item.item_type === "income" ? bucket.income : bucket.expense;
    }

    const menuItemClass = "flex min-h-10 w-full cursor-default items-center gap-2 px-3 py-2 text-sm text-stone-700 outline-none data-[highlighted]:bg-[var(--stor-surface-muted)] data-[highlighted]:text-stone-950";
</script>

{#snippet budgetSection(type: "income" | "expense", label: string, total: number, items: BudgetItem[])}
    <section class="stor-panel overflow-hidden" data-testid={`budget-group-${type}`}>
        <div class="flex items-center justify-between gap-3 border-b border-[var(--stor-rule)] bg-[var(--stor-surface-muted)] px-4 py-3">
            <div class="flex items-baseline gap-2.5">
                <h3 class="text-xs font-semibold uppercase tracking-wider text-[var(--stor-muted-text)]">{label}</h3>
                <span class="text-xs font-semibold tabular-nums {type === 'income' ? 'text-[var(--stor-positive)]' : 'text-[var(--stor-muted-text)]'}">
                    {type === "income" ? "+" : ""}{moneyFormatter.format(total)} / mo
                </span>
            </div>
            <CommandOnly>
                <button type="button" class="inline-flex min-h-8 items-center gap-1 text-xs font-semibold text-[var(--stor-accent-strong)]" onclick={() => openItem(type)}>
                    <IconPlus class="h-3.5 w-3.5" /> Add {type}
                </button>
            </CommandOnly>
        </div>

        {#if items.length === 0}
            <CommandOnly>
                <button type="button" class="w-full px-4 py-8 text-center text-sm text-[var(--stor-muted-text)] hover:bg-[var(--stor-surface-muted)]" onclick={() => openItem(type)}>
                    Add your first planned {type}.
                </button>
            </CommandOnly>
        {:else}
            <div class="divide-y divide-[var(--stor-rule)]">
                {#each items as item (item.id)}
                    {@const Icon = categoryIcon(item.category)}
                    {@const rule = recurringRules[item.id] ?? null}
                    {@const actual = actualFor(item)}
                    {@const plannedAmt = Math.max(1, Number(item.amount))}
                    {@const pct = Math.min(100, Math.round((actual / plannedAmt) * 100))}
                    {@const over = type === "expense" && actual > plannedAmt}
                    {@const settled = actual >= plannedAmt && !over}
                    <div
                        class="budget-row {selectedIds.has(item.id) ? 'bg-[var(--stor-accent-soft)]/50' : ''}"
                    >
                        <label class="hidden h-8 w-8 items-center justify-center md:flex">
                            <input
                                type="checkbox"
                                class="h-4 w-4 rounded border-[var(--stor-field-border)] accent-[var(--stor-action)]"
                                checked={selectedIds.has(item.id)}
                                aria-label={`Select ${item.name}`}
                                onchange={(event) => setSelected([item], event.currentTarget.checked)}
                            />
                        </label>

                        <span class="cat-tile {type === 'income' ? 'income' : ''}" aria-hidden="true">
                            <Icon class="h-4 w-4" />
                        </span>

                        <button type="button" class="min-w-0 text-left" onclick={() => openItem(type, item)}>
                            <span class="block truncate text-[13.5px] font-medium text-[var(--stor-ink)]">{item.name}</span>
                            <span class="block truncate text-[11.5px] text-[var(--stor-faint-text)]">{categoryLabel(item.category)}</span>
                        </button>

                        <div class="hidden lg:block">
                            <CommandOnly>
                                <button
                                    type="button"
                                    class="rule-pill"
                                    class:off={!rule?.enabled}
                                    onclick={() => (ruleDrawerItem = item)}
                                >
                                    <IconRepeat class="h-3.5 w-3.5 shrink-0" />
                                    <span>{formatRecurringRule(rule)}</span>
                                </button>
                            </CommandOnly>
                        </div>

                        <div class="hidden xl:flex flex-col gap-1">
                            <div class="flex items-center justify-between text-[11px] text-[var(--stor-muted-text)]">
                                <span>This month</span>
                                <strong class="tabular-nums {over ? 'text-[var(--stor-negative)]' : 'text-[var(--stor-ink)]'}">
                                    {formatAmount(actual)} / {formatAmount(Number(item.amount))}
                                </strong>
                            </div>
                            <div class="h-1.5 overflow-hidden rounded-full bg-[var(--stor-surface-well)]">
                                <div
                                    class="h-full rounded-full {over ? 'bg-[var(--stor-negative)]' : settled ? 'bg-[var(--stor-positive)]' : 'bg-[var(--stor-action)]'}"
                                    style:width={`${pct}%`}
                                ></div>
                            </div>
                        </div>

                        <div class="text-right text-[13.5px] font-semibold tabular-nums {type === 'income' ? 'text-[var(--stor-positive)]' : 'text-[var(--stor-ink)]'}">
                            {type === "income" ? "+" : ""}{moneyFormatter.format(Number(item.amount))}
                        </div>

                        <div class="flex items-center justify-end gap-1.5">
                            <CommandOnly>
                                <button
                                    type="button"
                                    role="switch"
                                    aria-checked={!!rule?.enabled}
                                    aria-label={`Auto-schedule ${item.name} on Cash Flow`}
                                    title={rule?.enabled ? "Auto-scheduled on Cash Flow" : "Turn on recurring schedule"}
                                    class="relative h-5 w-9 shrink-0 rounded-full transition-colors {rule?.enabled ? 'bg-[var(--stor-action)]' : 'bg-[var(--stor-surface-well)] shadow-[inset_0_0_0_1px_var(--stor-border)]'}"
                                    onclick={() => toggleAutoSchedule(item)}
                                >
                                    <span class="absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-[left] {rule?.enabled ? 'left-[18px]' : 'left-0.5'}"></span>
                                </button>
                            </CommandOnly>
                            <CommandOnly>
                                <DropdownMenu.Root>
                                    <DropdownMenu.Trigger class="flex h-8 w-8 items-center justify-center rounded-lg text-[var(--stor-muted-text)] hover:bg-[var(--stor-surface-muted)]" aria-label={`Actions for ${item.name}`}>
                                        <IconDots class="h-4 w-4" />
                                    </DropdownMenu.Trigger>
                                    <DropdownMenu.Portal>
                                        <DropdownMenu.Content sideOffset={4} align="end" class="stor-menu z-[var(--stor-layer-menu)] min-w-44 overflow-hidden py-1">
                                            <DropdownMenu.Item class={menuItemClass} onSelect={() => (ruleDrawerItem = item)}><IconRepeat class="h-4 w-4" /> Recurring schedule</DropdownMenu.Item>
                                            <DropdownMenu.Item class={menuItemClass} onSelect={() => openItem(type, item)}><IconPencil class="h-4 w-4" /> Edit item</DropdownMenu.Item>
                                            <DropdownMenu.Separator class="my-1 h-px bg-[var(--stor-border)]" />
                                            <DropdownMenu.Item class={`${menuItemClass} text-[var(--stor-negative)]`} onSelect={() => (pendingDeleteItem = item)}><IconDelete class="h-4 w-4" /> Delete</DropdownMenu.Item>
                                        </DropdownMenu.Content>
                                    </DropdownMenu.Portal>
                                </DropdownMenu.Root>
                            </CommandOnly>
                        </div>
                    </div>
                {/each}
            </div>
        {/if}
    </section>
{/snippet}

{#if plans.length === 0}
    <section class="stor-panel mx-2.5 mt-3 flex min-h-80 flex-col items-center justify-center px-6 py-12 text-center sm:mx-3">
        <div class="flex h-12 w-12 items-center justify-center rounded-2xl bg-[var(--stor-accent-soft)] text-2xl font-semibold text-[var(--stor-accent-strong)]">+</div>
        <h2 class="mt-4 text-lg font-semibold text-[var(--stor-ink)]">Plan your budget &amp; recurring bills</h2>
        <p class="mt-2 max-w-md text-sm leading-6 text-[var(--stor-muted-text)]">Create a baseline scenario for expected income and expenses. Toggle recurring rules to auto-populate upcoming rows onto your Cash Flow timeline.</p>
        <CommandOnly><Button class="mt-5" onclick={() => planDrawerMode = "create"}><IconPlus class="h-4 w-4" /> Create first plan</Button></CommandOnly>
    </section>
{:else if selectedPlan}
    <div class="min-h-0 flex-1 overflow-y-auto p-2.5 pb-24 sm:p-3 lg:pb-6">
        <div class="mx-auto max-w-6xl space-y-4">
            <!-- Desktop Scenario Pills + Actions -->
            <div class="hidden flex-wrap items-center justify-between gap-2 md:flex">
                <div class="flex flex-wrap items-center gap-2">
                    {#each plans as plan (plan.id)}
                        {@const isSelected = plan.id === selectedPlan.id}
                        {@const isTimelineActive = plan.id === effectiveActivePlanId}
                        <button
                            type="button"
                            class="plan-pill"
                            class:active={isSelected}
                            onclick={() => selectPlan(plan.id)}
                        >
                            <span>{plan.name}</span>
                            {#if isTimelineActive}
                                <span class="live-tag">Active on timeline</span>
                            {/if}
                        </button>
                    {/each}
                </div>
                <div class="flex items-center gap-2">
                    {#if selectedPlan.id !== effectiveActivePlanId}
                        <CommandOnly>
                            <Button variant="secondary" size="sm" onclick={() => setAsActivePlan(selectedPlan.id)}>Set active</Button>
                        </CommandOnly>
                    {/if}
                    <CommandOnly>
                        <DropdownMenu.Root>
                            <DropdownMenu.Trigger class="flex h-9 w-9 items-center justify-center rounded-xl text-[var(--stor-muted-text)] hover:bg-[var(--stor-surface-muted)]" aria-label="Plan actions">
                                <IconDots class="h-5 w-5" />
                            </DropdownMenu.Trigger>
                            <DropdownMenu.Portal>
                                <DropdownMenu.Content sideOffset={6} align="end" class="stor-menu z-[var(--stor-layer-menu)] min-w-48 overflow-hidden py-1">
                                    <DropdownMenu.Item class={menuItemClass} onSelect={() => planDrawerMode = "rename"}><IconPencil class="h-4 w-4" /> Rename</DropdownMenu.Item>
                                    <DropdownMenu.Item class={menuItemClass} onSelect={() => planDrawerMode = "duplicate"}><IconContentCopy class="h-4 w-4" /> Duplicate plan</DropdownMenu.Item>
                                    <DropdownMenu.Separator class="my-1 h-px bg-[var(--stor-border)]" />
                                    <DropdownMenu.Item class={`${menuItemClass} text-[var(--stor-negative)]`} onSelect={() => pendingDeletePlan = true}><IconDelete class="h-4 w-4" /> Delete plan</DropdownMenu.Item>
                                </DropdownMenu.Content>
                            </DropdownMenu.Portal>
                        </DropdownMenu.Root>
                    </CommandOnly>
                    <CommandOnly><Button variant="secondary" size="sm" onclick={() => planDrawerMode = "create"}><IconPlus class="h-4 w-4" /> New scenario</Button></CommandOnly>
                </div>
            </div>

            <!-- Mobile Scenario Picker -->
            <div class="flex h-12 items-center gap-1.5 rounded-2xl border border-[var(--stor-hairline)] bg-[var(--stor-surface)] pl-2 pr-1 md:hidden">
                <Select class="min-w-0 flex-1" value={selectedPlan.id} options={planOptions} ariaLabel="Selected budget plan" onValueChange={selectPlan} />
                <CommandOnly>
                    <DropdownMenu.Root>
                        <DropdownMenu.Trigger class="flex h-11 w-11 items-center justify-center rounded-xl text-[var(--stor-muted-text)]" aria-label="Plan actions"><IconDots class="h-5 w-5" /></DropdownMenu.Trigger>
                        <DropdownMenu.Portal>
                            <DropdownMenu.Content sideOffset={6} align="end" class="stor-menu z-[var(--stor-layer-menu)] min-w-48 overflow-hidden py-1">
                                <DropdownMenu.Item class={menuItemClass} onSelect={() => planDrawerMode = "create"}><IconPlus class="h-4 w-4" /> New scenario</DropdownMenu.Item>
                                <DropdownMenu.Item class={menuItemClass} onSelect={() => planDrawerMode = "rename"}><IconPencil class="h-4 w-4" /> Rename</DropdownMenu.Item>
                                <DropdownMenu.Separator class="my-1 h-px bg-[var(--stor-border)]" />
                                <DropdownMenu.Item class={`${menuItemClass} text-[var(--stor-negative)]`} onSelect={() => pendingDeletePlan = true}><IconDelete class="h-4 w-4" /> Delete plan</DropdownMenu.Item>
                            </DropdownMenu.Content>
                        </DropdownMenu.Portal>
                    </DropdownMenu.Root>
                </CommandOnly>
            </div>

            <!-- 4-Column Editorial Summary Band -->
            {#snippet summary(sheet: boolean)}
                <section class="stor-panel grid grid-cols-2 gap-4 p-4 lg:grid-cols-4 lg:gap-6 {sheet ? '' : 'max-md:hidden'}" aria-label="Budget summary">
                    <div class="min-w-0">
                        <p class="text-xs font-medium text-[var(--stor-muted-text)]">Planned income</p>
                        <p class="mt-1 text-xl font-semibold tabular-nums text-[var(--stor-positive)]">{moneyFormatter.format(selectedPlan.income_total)}</p>
                        <p class="mt-0.5 text-[11.5px] text-[var(--stor-faint-text)]">{incomeItems.length} {incomeItems.length === 1 ? "source" : "sources"}</p>
                    </div>
                    <div class="min-w-0 lg:border-l lg:border-[var(--stor-rule)] lg:pl-6">
                        <p class="text-xs font-medium text-[var(--stor-muted-text)]">Planned expenses</p>
                        <p class="mt-1 text-xl font-semibold tabular-nums text-[var(--stor-ink)]">{moneyFormatter.format(selectedPlan.expense_total)}</p>
                        <p class="mt-0.5 text-[11.5px] text-[var(--stor-faint-text)]">{expenseItems.length} {expenseItems.length === 1 ? "item" : "items"}</p>
                    </div>
                    <div class="min-w-0 lg:border-l lg:border-[var(--stor-rule)] lg:pl-6">
                        <p class="text-xs font-medium text-[var(--stor-muted-text)]">Monthly surplus</p>
                        <p class="mt-1 text-xl font-semibold tabular-nums {remaining >= 0 ? 'text-[var(--stor-positive)]' : 'text-[var(--stor-negative)]'}">
                            {remaining > 0 ? "+" : ""}{moneyFormatter.format(remaining)}
                        </p>
                        <p class="mt-0.5 text-[11.5px] text-[var(--stor-faint-text)]">{savingsRate}% savings rate</p>
                    </div>
                    <div class="min-w-0 lg:border-l lg:border-[var(--stor-rule)] lg:pl-6">
                        <p class="text-xs font-medium text-[var(--stor-muted-text)]">Auto-scheduled</p>
                        <p class="mt-1 text-xl font-semibold tabular-nums text-[var(--stor-ink)]">{autoScheduledCount} / {allItems.length}</p>
                        <p class="mt-0.5 text-[11.5px] text-[var(--stor-faint-text)]">Recurring rules → Cash Flow</p>
                    </div>
                </section>
            {/snippet}

            {@render summary(false)}
            <PhoneGlance label="Monthly surplus" value={`${remaining > 0 ? "+" : ""}${formatAmount(remaining)}`} unit="Kč" tone={remaining > 0 ? "positive" : "default"} title={selectedPlan.name}>
                {@render summary(true)}
            </PhoneGlance>

            {#if selectionCount > 0}
                <div class="sticky top-0 z-10 flex flex-wrap items-center gap-x-5 gap-y-2 rounded-2xl bg-[var(--stor-accent-soft)] px-4 py-3 text-sm" aria-label="Selected item totals">
                    <strong>{selectionCount} selected</strong>
                    {#if selectionSummaryLoading}
                        <span class="text-[var(--stor-muted-text)]">Calculating totals…</span>
                    {:else}
                        <div><span class="text-[var(--stor-muted-text)]">Income</span> <strong class="ml-1 tabular-nums">+{moneyFormatter.format(selectionSummary.incomeTotal)}</strong></div>
                        <div><span class="text-[var(--stor-muted-text)]">Expenses</span> <strong class="ml-1 tabular-nums">{moneyFormatter.format(-selectionSummary.expenseTotal)}</strong></div>
                        <div><span class="text-[var(--stor-muted-text)]">Net</span> <strong class="ml-1 tabular-nums">{moneyFormatter.format(selectionSummary.netTotal)}</strong></div>
                    {/if}
                    <div class="ml-auto flex items-center gap-2">
                        {#if !allVisibleSelected}
                            <button type="button" onclick={selectAllVisible} class="h-8 px-2 text-xs font-semibold text-[var(--stor-accent-strong)]">Select all {allItems.length}</button>
                        {/if}
                        <CommandOnly><button type="button" disabled={batchBusy} onclick={requestDeleteSelected} class="h-8 rounded-lg px-3 text-xs font-semibold text-[var(--stor-negative)] disabled:opacity-50">Delete</button></CommandOnly>
                        <button type="button" onclick={clearSelection} class="h-8 px-2 text-xs text-[var(--stor-accent-strong)]">Clear</button>
                    </div>
                </div>
            {/if}

            {@render budgetSection("income", "Income", selectedPlan.income_total, incomeItems)}
            {@render budgetSection("expense", "Expenses & Recurring Rules", selectedPlan.expense_total, expenseItems)}
        </div>
    </div>

    <MobilePageAction hideWhenModalOpen hidden={selectionCount > 0} isModalOpen={itemDrawerOpen || planDrawerMode !== null || pendingDeletePlan || pendingDeleteItem !== null || confirmDeleteSelectedOpen || ruleDrawerItem !== null}>
        <CommandOnly>
            <Button class="h-12 w-full text-[15px]" onclick={() => openItem("expense")} data-testid="open-budget-item-mobile">
                <IconPlus class="h-5 w-5" /> <span class="stor-action-label">Add item</span>
            </Button>
        </CommandOnly>
    </MobilePageAction>
{/if}

<CommandOnly onUnavailable={() => { planDrawerMode = null; itemDrawerOpen = false; ruleDrawerItem = null; }}>
    <BudgetPlanDrawer show={planDrawerMode !== null} title={planDrawerCopy.title} description={planDrawerCopy.description} actionLabel={planDrawerCopy.action} initialName={planDrawerMode === "create" && phone.current && selectedPlan ? nextPlanName(selectedPlan.name) : planDrawerCopy.name} onClose={() => planDrawerMode = null} onSave={savePlan}
        startFrom={planDrawerMode === "create" && phone.current && selectedPlan ? { label: selectedPlan.name, detail: `Copies ${selectedPlan.item_count} ${selectedPlan.item_count === 1 ? "item" : "items"} · ${moneyFormatter.format(selectedPlan.income_total)} in, ${moneyFormatter.format(selectedPlan.expense_total)} out` } : undefined} />
    {#if selectedPlan}<BudgetItemDrawer show={itemDrawerOpen} planName={selectedPlan.name} initialItem={editingItem} initialType={itemDrawerType} onClose={() => itemDrawerOpen = false} onSave={saveItem} />{/if}
    <RecurringRuleDrawer
        show={ruleDrawerItem !== null}
        item={ruleDrawerItem}
        rule={ruleDrawerItem ? (recurringRules[ruleDrawerItem.id] ?? null) : null}
        {today}
        onClose={() => (ruleDrawerItem = null)}
        onSave={saveRule}
    />
</CommandOnly>

<CommandConfirmDialog show={pendingDeletePlan} title={`Delete ${selectedPlan?.name ?? "this plan"}?`} message={`This removes the plan and its ${selectedPlan?.item_count ?? 0} planned items.`} confirmLabel="Delete plan" onConfirm={deletePlan} onCancel={() => pendingDeletePlan = false} />
<CommandConfirmDialog show={pendingDeleteItem !== null} title="Delete planned item?" message={`This removes ${pendingDeleteItem?.name ?? "the item"} from the plan.`} confirmLabel="Delete item" onConfirm={deleteItem} onCancel={() => pendingDeleteItem = null} />
<CommandConfirmDialog show={confirmDeleteSelectedOpen} title={deleteSelectedTitle} message={deleteSelectedMessage} confirmLabel={selectionCount === 1 ? "Delete item" : "Delete items"} onConfirm={deleteSelected} onCancel={() => confirmDeleteSelectedOpen = false} />

<style>
    .plan-pill {
        display: inline-flex;
        align-items: center;
        gap: 7px;
        height: 34px;
        padding: 0 13px;
        border: 1px solid var(--stor-hairline);
        border-radius: 999px;
        background: var(--stor-surface);
        font-size: 13px;
        font-weight: 500;
        color: var(--stor-muted-text);
    }
    .plan-pill.active {
        border-color: transparent;
        background: var(--stor-ink);
        color: var(--stor-surface);
    }
    .live-tag {
        padding: 1px 7px;
        border-radius: 999px;
        background: var(--stor-positive-soft);
        color: var(--stor-positive);
        font-size: 10.5px;
        font-weight: 650;
    }
    .plan-pill.active .live-tag {
        background: color-mix(in srgb, var(--stor-positive) 25%, transparent);
        color: var(--stor-surface);
    }

    .budget-row {
        display: grid;
        grid-template-columns: 30px minmax(0, 1fr) auto auto;
        align-items: center;
        gap: 10px;
        padding: 11px 16px;
    }
    @media (min-width: 768px) {
        .budget-row {
            grid-template-columns: 32px 30px minmax(0, 1fr) auto auto;
        }
    }
    @media (min-width: 1024px) {
        .budget-row {
            grid-template-columns: 32px 30px minmax(0, 1.3fr) 156px 115px 80px;
        }
    }
    @media (min-width: 1280px) {
        .budget-row {
            grid-template-columns: 32px 30px minmax(0, 1.25fr) 150px 155px 110px 80px;
        }
    }
    .budget-row:hover {
        background: var(--stor-surface-hover);
    }
    .cat-tile {
        display: grid;
        place-items: center;
        width: 30px;
        height: 30px;
        border-radius: 9px;
        background: var(--stor-surface-muted);
        color: var(--stor-muted-text);
        flex: none;
    }
    .cat-tile.income {
        background: var(--stor-positive-soft);
        color: var(--stor-positive);
    }
    .rule-pill {
        display: inline-flex;
        align-items: center;
        gap: 5px;
        padding: 4px 9px;
        border: 1px solid var(--stor-hairline);
        border-radius: 8px;
        background: var(--stor-surface-muted);
        font-size: 11.5px;
        font-weight: 550;
        color: var(--stor-ink);
        white-space: nowrap;
    }
    .rule-pill.off {
        border-style: dashed;
        background: transparent;
        color: var(--stor-faint-text);
    }
    .rule-pill:hover {
        border-color: var(--stor-action);
    }
</style>
