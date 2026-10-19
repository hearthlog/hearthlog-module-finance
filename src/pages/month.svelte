<script lang="ts">
    import { browser } from '$app/env';
    import { goto } from "$app/navigation";
    import { page } from "$app/state";
    import { tick, untrack } from "svelte";
    import { format, parseISO } from "date-fns";
    import { providePageResource } from "@hearthlog/sdk/runtime";
    import { PageDataStatus } from "@hearthlog/sdk/ui";
    import { DataPlaceholder } from "@hearthlog/sdk/ui";
    import { refreshPageData } from "@hearthlog/sdk/runtime";
    import { appClock, contextualHref } from "@hearthlog/sdk/runtime";
    import { runCommandAction as runWorkspaceCommandAction } from "@hearthlog/sdk/runtime";
    import type { AddTransactionEvent, RemoveTransactionEvent, UpdateTransactionEvent } from "@hearthlog/sdk/data";
    import { executeLocalCommand } from "@hearthlog/sdk/data";
    import { events } from "@hearthlog/sdk/runtime";
    import { notify } from "@hearthlog/sdk/runtime";
    import { saveBalanceFloor } from "../finance/floor.js";
    import { clampMonth, monthBounds, monthWindow, parseShow, showsKind, type TimelineKind, type TimelineShow } from "../finance/timeline.js";
    import { queryDatabase } from "@hearthlog/sdk/data";
    import { monthKeyOf, shiftMonthKey } from "@hearthlog/sdk/axis";
    import { PageHeader } from "@hearthlog/sdk/ui";
    import { RouteTabs } from "@hearthlog/sdk/ui";
    import { MonthNavigator } from "@hearthlog/sdk/ui";
    import { Button } from "@hearthlog/sdk/ui";
    import { CommandOnly } from "@hearthlog/sdk/ui";
    import { MobilePageAction } from "@hearthlog/sdk/ui";
    import BudgetPlans from "../components/finance/BudgetPlans.svelte";
    import FinanceReadout from "../components/finance/FinanceReadout.svelte";
    import EndlessTimeline from "../components/finance/EndlessTimeline.svelte";
    import TransactionSelectionBar from "../components/finance/TransactionSelectionBar.svelte";
    import { TimelineMonths } from "../components/finance/timeline-months.svelte.js";
    import SortUncategorizedSheet, { type CategoryChange } from "../components/finance/SortUncategorizedSheet.svelte";
    import type { RowLike } from "../components/finance/TimelineRowItem.svelte";
    import { createTransactionDraft, formatDayRange, type TransactionDraft } from "../components/finance/transaction-draft.js";
    import IconPlus from "~icons/mdi/plus";
    import IconTune from "~icons/mdi/tune-variant";
    import IconChevronRight from "~icons/mdi/chevron-right";
    import { MediaQuery } from "svelte/reactivity";
    import { Modal } from "@hearthlog/sdk/ui";
    import { PhoneGlance } from "@hearthlog/sdk/ui";
    import AssetsSheet from "../components/finance/AssetsSheet.svelte";
    import { phoneHeader } from "@hearthlog/sdk/runtime";
    import { longPress } from "@hearthlog/sdk/runtime";
    import { formatAmount } from "@hearthlog/sdk/format";
    import { loadPhoneBalance, savePhoneBalance } from "../finance/phone-balance.js";
    import type { FinancePageData } from "./month.js";

    type TransactionDrawerComponent = typeof import("../components/finance/TransactionDrawer.svelte").default;
    type FinanceData = FinancePageData;

    const DAY = "yyyy-MM-dd";

    let { data: routeData } = $props();
    const resource = $derived(routeData.pageResource);

    // Keep the last loaded data on screen while a refresh loads, so saves swap
    // atomically. PageDataStatus keeps the real resource for perf.
    let shown = $state.raw<FinanceData | null>(null);
    let revision = $state(0);
    const view = $derived(shown ?? resource.data);
    const displayResource = $derived({
        loading: shown ? false : resource.loading,
        error: resource.error,
        measurement: resource.measurement,
    });
    providePageResource(() => displayResource);

    function runCommandAction(action: () => void): boolean {
        return !displayResource.loading && runWorkspaceCommandAction(action);
    }

    // ---------------------------------------------------------------- shallow view state
    let floor = $state(0);
    let floorTouched = false;
    /** The month at the top of the list and the first day showing. */
    let visibleMonth = $state("");
    let visibleDate = $state("");
    let selection = $state.raw(new Map<string, RowLike>());
    let hoveredId = $state<string | null>(null);
    let flashId = $state<string | null>(null);

    const today = $derived(view.today || format(appClock.now(), DAY));
    const todayMonth = $derived(monthKeyOf(today));

    let timeline = $state<EndlessTimeline>();

    function applyData(next: FinanceData): void {
        const previous = shown;
        shown = next;
        revision += 1;
        if (!floorTouched) floor = next.floor;
        const anchor = clampMonth(`${next.year}-${String(next.month).padStart(2, "0")}`, monthBounds(show, next.today, next.outlook.lastDone));
        if (!previous) {
            // A month chosen while the page was loading wins over the address.
            if (!visibleMonth) {
                visibleMonth = anchor;
                visibleDate = anchor === monthKeyOf(next.today) ? next.today : `${anchor}-01`;
            }
        } else if ((previous.year !== next.year || previous.month !== next.month) && anchor !== visibleMonth) {
            // A real navigation to another month while the views are open.
            void tick().then(() => goToMonth(anchor));
        }
    }

    $effect(() => {
        if (resource.loading) return;
        const next = resource.data;
        untrack(() => applyData(next));
    });

    const isBudgetTab = $derived(page.url.searchParams.get("tab") === "budget");
    const show = $derived<TimelineShow>(parseShow(page.url.searchParams));
    /** Plans start at today's month; done history ends there or at its last early row. */
    const bounds = $derived(monthBounds(show, today, view.outlook.lastDone));
    // Each filter has its own months; the list opens again when it changes.
    const months = $derived.by(() => {
        const current = show;
        return new TimelineMonths(() => ({ today, show: current }));
    });
    const year = $derived(Number((visibleMonth || todayMonth).slice(0, 4)));
    const month = $derived(Number((visibleMonth || todayMonth).slice(5, 7)));
    const monthLabel = $derived(format(new Date(year, month - 1, 1), "MMMM yyyy"));
    /** Where the list opens: Today in today's month, otherwise the first day of the month in view. */
    const openingDay = $derived(visibleMonth === todayMonth || !visibleMonth ? today : `${visibleMonth}-01`);
    /** New transactions start today, or on the first day in view in another month. */
    const contextDay = $derived(monthKeyOf(visibleDate || today) === todayMonth ? today : visibleDate);

    function setAddress(mutate: (url: URL) => void): void {
        const url = new URL(window.location.href);
        mutate(url);
        goto(`${url.pathname}${url.search}${url.hash}`, { shallow: true, replace: true });
    }

    // The filter is a real navigation (with history); the list opens again for it.
    let lastShow = untrack(() => show);
    $effect(() => {
        const current = show;
        if (current === lastShow) return;
        lastShow = current;
        untrack(() => {
            selection = new Map();
        });
    });

    function showHref(target: TimelineShow): string {
        return contextualHref(`/finance/${year}/${month}${target === "all" ? "" : `?show=${target}`}`);
    }

    // The address follows the month in view quietly, so a reload opens there.
    let addressTimer: ReturnType<typeof setTimeout> | undefined;
    function followVisible(visible: { month: string; date: string }): void {
        visibleMonth = visible.month;
        visibleDate = visible.date;
        clearTimeout(addressTimer);
        addressTimer = setTimeout(() => {
            if (isBudgetTab) return;
            const target = `/finance/${Number(visible.month.slice(0, 4))}/${Number(visible.month.slice(5, 7))}`;
            if (window.location.pathname !== target) setAddress((url) => { url.pathname = target; });
        }, 250);
    }

    $effect(() => () => clearTimeout(addressTimer));

    function goToMonth(month: string, behavior: ScrollBehavior = "auto"): void {
        const key = clampMonth(month, bounds);
        // The label follows at once; a view that is still opening opens there.
        followVisible({ month: key, date: key === todayMonth ? today : `${key}-01` });
        if (key === todayMonth) timeline?.scrollToToday(behavior);
        else timeline?.scrollToMonth(key, behavior);
    }

    /** Scrolls to a day, first switching to the filter for its kind when this one leaves it out. */
    async function goToDate(date: string, kind?: TimelineKind): Promise<void> {
        if (kind && !showsKind(show, kind)) {
            await goto(showHref(kind), { reset: false });
            await tick();
        }
        timeline?.scrollToDate(date);
    }

    /** A saved row's kind: anything marked done or dated before today is done. */
    function kindOf(status: "active" | "archived", date: string): TimelineKind {
        return status === "archived" || date < today ? "done" : "planned";
    }

    const financeTabs = $derived([
        { label: "Transactions", href: contextualHref(`/finance/${year}/${month}`), active: !isBudgetTab },
        { label: "Budget plans", href: contextualHref(`/finance/${year}/${month}?tab=budget`), active: isBudgetTab },
    ]);
    const filters: Array<{ id: TimelineShow; label: string }> = [
        { id: "all", label: "All" },
        { id: "planned", label: "Planned" },
        { id: "done", label: "Done" },
    ];

    function changeFloor(value: number): void {
        floor = value;
        floorTouched = true;
        void saveBalanceFloor(value).catch(() => notify.error("The floor could not be saved on this device"));
    }

    // ---------------------------------------------------------------- selection and hover
    const selectedIds = $derived(new Set(selection.keys()));
    const selectedRows = $derived([...selection.values()]);
    const visibleRows = $derived(months.get(visibleMonth)?.rows ?? []);

    function snapshot(row: RowLike): RowLike {
        return { id: row.id, name: row.name, amount: row.amount, date: row.date, category: row.category, kind: row.kind };
    }

    function selectRow(row: RowLike, selected: boolean): void {
        const next = new Map(selection);
        if (selected) next.set(row.id, snapshot(row));
        else next.delete(row.id);
        selection = next;
    }

    function selectAll(): void {
        selection = new Map(visibleRows.map((row) => [row.id, snapshot(row)]));
    }

    function forget(ids: string[]): void {
        const next = new Map(selection);
        for (const id of ids) next.delete(id);
        selection = next;
    }

    function hoverRow(row: RowLike | null): void {
        hoveredId = row?.id ?? null;
    }

    // ---------------------------------------------------------------- phones
    // Below 768 px the list is the page: one figure in the top bar, the rest in the Outlook sheet,
    // filters behind the options button, and rows without checkboxes until press and hold.
    const phone = new MediaQuery("max-width: 767px");
    let phoneBalance = $state(false);
    let optionsOpen = $state(false);
    let assetsSheetOpen = $state(false);
    /** Selecting on a phone: entered by press and hold or Select, left by clearing. */
    let selecting = $state(false);
    const selectingNow = $derived(selecting || selection.size > 0);
    /** The click that ends a press and hold is the long press's own; the action swallows it. */
    let pressEnding = false;

    $effect(() => {
        void loadPhoneBalance().then((on) => { phoneBalance = on; });
    });

    function togglePhoneBalance(): void {
        phoneBalance = !phoneBalance;
        void savePhoneBalance(phoneBalance).catch(() => notify.error("The setting could not be saved on this device"));
    }

    /** The one figure that decides the next step: what is available, or the low point once it drops under the floor. */
    const glance = $derived.by(() => {
        const low = view.outlook.low;
        if (low.date && low.amount < floor) {
            return { label: `Lowest · ${format(parseISO(low.date), "EEE d MMM")}`, value: formatAmount(low.amount), tone: "warning" as const };
        }
        return { label: "Available now", value: formatAmount(view.outlook.available), tone: "default" as const };
    });

    function rowFromElement(element: HTMLElement): RowLike | null {
        const id = element.dataset.rowId;
        const date = element.dataset.date;
        if (!id || !date) return null;
        const row = months.get(monthKeyOf(date))?.rows.find((candidate) => candidate.id === id);
        return row ? snapshot(row) : null;
    }

    function startSelecting(element: HTMLElement): void {
        pressEnding = true;
        setTimeout(() => { pressEnding = false; }, 800);
        selecting = true;
        const row = rowFromElement(element);
        if (row) selectRow(row, true);
    }

    /** While selecting on a phone, a tap on a row ticks it instead of opening it. */
    function selectingClick(event: MouseEvent): void {
        if (pressEnding) { pressEnding = false; return; }
        if (!phone.current || !selectingNow) return;
        const target = event.target as HTMLElement;
        const element = target.closest<HTMLElement>("[data-row-id]");
        if (!element || target.closest("[data-row-check]")) return;
        event.preventDefault();
        event.stopPropagation();
        const row = rowFromElement(element);
        if (row) selectRow(row, !selection.has(row.id));
    }

    function clearSelection(): void {
        selection = new Map();
        selecting = false;
    }

    // While selecting on a phone the top bar names the count, with Select all and Cancel.
    $effect(() => {
        if (!phone.current || !selectingNow || isBudgetTab) return;
        const count = selection.size;
        const all = count > 0 && count === visibleRows.length;
        phoneHeader.selection = {
            label: count === 0 ? "Select" : `${count} selected`,
            onSelectAll: all ? undefined : selectAll,
            onCancel: clearSelection,
        };
        return () => { phoneHeader.selection = null; };
    });

    // ---------------------------------------------------------------- drawer
    let drawerOpen = $state(false);
    let drawerDraft = $state<TransactionDraft>(createTransactionDraft(""));
    let TransactionDrawer = $state<TransactionDrawerComponent | null>(null);
    let transactionDrawerLoadPromise: Promise<void> | null = null;
    let handledNewTransactionUrl = $state("");
    let busyId = $state<string | null>(null);
    /** New transactions keep their events until saved, so retrying the same save stays idempotent. */
    let pendingAdd: { key: string; submissionId: string; events: AddTransactionEvent[] } | null = null;

    function loadTransactionDrawer(): Promise<void> {
        transactionDrawerLoadPromise ??= import("../components/finance/TransactionDrawer.svelte").then((module) => {
            TransactionDrawer = module.default;
        });
        return transactionDrawerLoadPromise;
    }

    function openDrawer(next: TransactionDraft): void {
        drawerDraft = next;
        pendingAdd = null;
        drawerOpen = true;
        void loadTransactionDrawer();
    }

    function openAddTransaction(date = contextDay, status: "active" | "archived" = "active"): void {
        const next = createTransactionDraft(date);
        next.status = status;
        openDrawer(next);
    }

    function openEditTransaction(row: RowLike): void {
        openDrawer({
            id: row.id,
            name: row.name,
            amount: Math.abs(row.amount),
            dueDate: row.date,
            category: row.category,
            status: row.kind === "done" ? "archived" : "active",
            direction: row.amount >= 0 ? "income" : "expense",
        });
    }

    // ---------------------------------------------------------------- filter counts
    /** Plans and done rows of the month in view, counted in SQL, shown on the filter. */
    let kindCounts = $state({ planned: 0, done: 0 });

    $effect(() => {
        const key = visibleMonth;
        void revision;
        if (!key || !shown || isBudgetTab) return;
        let current = true;
        const { start, end } = monthWindow(key);
        void queryDatabase((repositories) => repositories.transactions.countKindsInMonth(start, end, today))
            .then((counts) => { if (current) kindCounts = counts; })
            .catch(() => undefined);
        return () => { current = false; };
    });

    function filterCount(id: TimelineShow): number | null {
        return id === "planned" ? kindCounts.planned : id === "done" ? kindCounts.done : null;
    }

    // ---------------------------------------------------------------- sort uncategorized
    /** Rows of the month in view that still have no category, counted in SQL. */
    let uncategorized = $state(0);
    let sortOpen = $state(false);
    let sortMonth = $state("");

    $effect(() => {
        const key = visibleMonth;
        void revision;
        if (!key || !shown || isBudgetTab) return;
        let current = true;
        const { start, end } = monthWindow(key);
        void queryDatabase((repositories) => repositories.transactions.countUncategorizedInMonth(start, end))
            .then((count) => { if (current) uncategorized = count; })
            .catch(() => undefined);
        return () => { current = false; };
    });

    function openSort(): void {
        sortMonth = visibleMonth || todayMonth;
        sortOpen = true;
    }

    async function writeCategories(changes: CategoryChange[], pick: (change: CategoryChange) => { category: string; source: string }): Promise<void> {
        // One submission identity per action: retrying the same Apply stays idempotent.
        const submissionId = crypto.randomUUID();
        await executeLocalCommand(changes.map((change) => ({
            id: crypto.randomUUID(),
            type: "TRANSACTION_UPDATED" as const,
            timestamp: Date.now(),
            payload: { id: change.id, transaction_category: pick(change).category, category_source: pick(change).source },
        } satisfies UpdateTransactionEvent)), { submissionId });
        await refreshFinanceData();
    }

    async function applyCategories(changes: CategoryChange[]): Promise<void> {
        try {
            await writeCategories(changes, (change) => ({ category: change.category, source: change.source }));
        } catch (error) {
            console.error("[Finance] Failed to sort transactions:", error);
            throw error;
        }
        sortOpen = false;
        notify.success(`${plural(changes.length, "transaction", "transactions")} sorted`, {
            label: "Undo",
            run: () => undoCategories(changes).catch(() => undefined),
        });
    }

    /** Restores the categories and provenance the sorted rows had before. */
    async function undoCategories(changes: CategoryChange[]): Promise<void> {
        try {
            await writeCategories(changes, (change) => change.previous);
            notify.success(`${plural(changes.length, "transaction", "transactions")} restored`);
        } catch (error) {
            console.error("[Finance] Failed to undo sorting:", error);
            notify.error("Could not undo the sorting");
            throw error;
        }
    }

    // ---------------------------------------------------------------- mutations
    function refreshFinanceData(): Promise<void> {
        return refreshPageData("app:assets", "app:transactions", "app:budgets");
    }

    function flash(id: string): void {
        flashId = id;
        setTimeout(() => { if (flashId === id) flashId = null; }, 1900);
    }

    const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

    /** Names the day, with a way there, when a saved entry lands outside the filter or month in view. */
    function savedNotice(message: string, date: string, kind: TimelineKind): void {
        if (showsKind(show, kind) && monthKeyOf(date) === visibleMonth) {
            notify.success(message);
            return;
        }
        notify.success(`${message} · ${format(parseISO(date), "d MMM yyyy")}`, { label: "Show", run: () => void goToDate(date, kind) });
    }

    /** The category's provenance, sent only when the category was filled or chosen in the drawer. */
    function sourceOf(draft: TransactionDraft): { category_source?: string } {
        return draft.categorySource === undefined ? {} : { category_source: draft.categorySource };
    }

    async function saveTransaction(drafts: TransactionDraft[]): Promise<void> {
        const [next] = drafts;
        try {
            if (next.id) {
                await executeLocalCommand({
                    id: crypto.randomUUID(),
                    type: "TRANSACTION_UPDATED",
                    timestamp: Date.now(),
                    payload: { id: next.id, name: next.name, amount: Number(next.amount), due_date: next.dueDate, transaction_category: next.category, transaction_status: next.status, ...sourceOf(next) },
                } satisfies UpdateTransactionEvent);
                await refreshFinanceData();
                forget([next.id]);
                savedNotice("Transaction updated", next.dueDate, kindOf(next.status, next.dueDate));
            } else {
                const key = JSON.stringify(drafts);
                if (pendingAdd?.key !== key) {
                    const timestamp = Date.now();
                    pendingAdd = {
                        key,
                        submissionId: crypto.randomUUID(),
                        events: drafts.map((draft) => ({
                            id: crypto.randomUUID(),
                            type: "TRANSACTION_ADDED",
                            timestamp,
                            payload: { id: crypto.randomUUID(), name: draft.name, amount: Number(draft.amount), due_date: draft.dueDate, transaction_category: draft.category, transaction_status: draft.status, ...sourceOf(draft) },
                        } satisfies AddTransactionEvent)),
                    };
                }
                await executeLocalCommand(pendingAdd.events, { submissionId: pendingAdd.submissionId });
                const ids = pendingAdd.events.map((event) => event.payload.id);
                await refreshFinanceData();
                pendingAdd = null;
                flash(ids[0]);
                if (ids.length === 1) {
                    savedNotice(next.status === "archived" ? "Transaction recorded as done" : "Transaction planned", next.dueDate, kindOf(next.status, next.dueDate));
                } else {
                    const outcome = drafts.every((draft) => draft.status === "archived") ? "recorded as done"
                        : drafts.every((draft) => draft.status === "active") ? "planned" : "added";
                    notify.success(`${ids.length} transactions ${outcome} · ${formatDayRange(next.dueDate, drafts[drafts.length - 1].dueDate)}`, {
                        label: "Undo",
                        // Failures are reported by removeTransactions.
                        run: () => removeTransactions(ids).catch(() => undefined),
                    });
                }
            }
            drawerOpen = false;
        } catch (error) {
            console.error("[Finance] Failed to save transaction:", error);
            throw new Error(drafts.length > 1 ? "The transactions could not be saved. Your values are still here." : "The transaction could not be saved. Your values are still here.");
        }
    }

    async function setStatus(ids: string[], status: "active" | "archived"): Promise<void> {
        if (ids.length === 0) return;
        // One submission identity per batch: retrying the same action stays idempotent.
        const submissionId = crypto.randomUUID();
        try {
            await executeLocalCommand(ids.map((id) => ({
                id: crypto.randomUUID(),
                type: "TRANSACTION_UPDATED" as const,
                timestamp: Date.now(),
                payload: { id, transaction_status: status },
            })), { submissionId });
            await refreshFinanceData();
        } catch (error) {
            console.error("[Finance] Failed to update transaction status:", error);
            notify.error("Could not update the transaction status");
            throw error;
        }
    }

    /** Confirms rows as done in one command; Undo restores them to plans. */
    async function markDone(ids: string[], label?: string): Promise<void> {
        if (ids.length === 0) return;
        await setStatus(ids, "archived");
        forget(ids);
        notify.success(label ?? `${plural(ids.length, "payment", "payments")} marked done`, {
            label: "Undo",
            run: () => restore(ids),
        });
    }

    async function restore(ids: string[]): Promise<void> {
        await setStatus(ids, "active");
        forget(ids);
        notify.success(`${plural(ids.length, "transaction", "transactions")} restored to plans`);
    }

    async function markRowDone(row: RowLike): Promise<void> {
        busyId = row.id;
        try {
            await markDone([row.id], `${row.name || "Transaction"} marked done`);
        } catch {
            // Reported by setStatus.
        } finally {
            busyId = null;
        }
    }

    async function restoreRow(row: RowLike): Promise<void> {
        busyId = row.id;
        try {
            await restore([row.id]);
        } catch {
            // Reported by setStatus.
        } finally {
            busyId = null;
        }
    }

    /** Reschedules rows; a row done only because its day passed becomes a plan again when moved to today or later. */
    async function moveTransactions(rows: RowLike[], dueDate: string): Promise<void> {
        if (rows.length === 0) return;
        const ids = rows.map((row) => row.id);
        const replanned = (row: RowLike) => row.date < today && dueDate >= today;
        const submissionId = crypto.randomUUID();
        try {
            await executeLocalCommand(rows.map((row) => ({
                id: crypto.randomUUID(),
                type: "TRANSACTION_UPDATED" as const,
                timestamp: Date.now(),
                payload: replanned(row) ? { id: row.id, due_date: dueDate, transaction_status: "active" as const } : { id: row.id, due_date: dueDate },
            })), { submissionId });
            await refreshFinanceData();
            forget(ids);
            const kind: TimelineKind = dueDate >= today && rows.some((row) => row.kind === "planned" || replanned(row)) ? "planned" : "done";
            savedNotice(`${plural(ids.length, "transaction", "transactions")} moved to ${format(parseISO(dueDate), "d MMM yyyy")}`, dueDate, kind);
        } catch (error) {
            console.error("[Finance] Failed to move transactions:", error);
            notify.error("Could not move the selected transactions");
            throw error;
        }
    }

    async function removeTransactions(ids: string[]): Promise<void> {
        if (ids.length === 0) return;
        const submissionId = crypto.randomUUID();
        try {
            await executeLocalCommand(ids.map((id) => ({
                id: crypto.randomUUID(),
                type: "TRANSACTION_REMOVED" as const,
                timestamp: Date.now(),
                payload: { id },
            } satisfies RemoveTransactionEvent)), { submissionId });
            await refreshFinanceData();
            forget(ids);
            notify.success(ids.length === 1 ? "Transaction deleted" : `${ids.length} transactions deleted`);
        } catch (error) {
            console.error("[Finance] Failed to delete transactions:", error);
            notify.error(ids.length === 1 ? "Could not delete the transaction" : "Could not delete the selected transactions");
            throw error;
        }
    }

    async function deleteRow(row: RowLike): Promise<void> {
        busyId = row.id;
        try {
            await removeTransactions([row.id]);
        } catch {
            // Reported by removeTransactions.
        } finally {
            busyId = null;
        }
    }

    async function deleteFromDrawer(): Promise<void> {
        if (!drawerDraft.id) return;
        await removeTransactions([drawerDraft.id]);
        drawerOpen = false;
    }

    // ---------------------------------------------------------------- effects
    let lastSeenEventsUpdatedAt = 0;
    $effect(() => {
        if (displayResource.loading || !browser) return;
        const updatedAt = events.refreshRequiredAt;
        if (!updatedAt || updatedAt === lastSeenEventsUpdatedAt) return;
        lastSeenEventsUpdatedAt = updatedAt;
        void refreshFinanceData().catch((error) => console.warn("[Finance] Refresh failed", error));
    });

    $effect(() => {
        if (displayResource.loading || !browser) return;
        if (page.url.searchParams.get("newTransaction") !== "1") return;
        if (handledNewTransactionUrl === page.url.href) return;
        if (!runCommandAction(() => openAddTransaction())) return;
        handledNewTransactionUrl = page.url.href;
        setAddress((url) => url.searchParams.delete("newTransaction"));
    });

    function handleKeydown(event: KeyboardEvent): void {
        if (drawerOpen || isBudgetTab || event.metaKey || event.ctrlKey || event.altKey) return;
        const target = event.target as HTMLElement;
        if (target.closest("[data-month-navigation], [data-month-picker], [role='dialog'], [role='menu']")) return;
        if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement || target.isContentEditable) return;
        if (event.key === "ArrowLeft") goToMonth(shiftMonthKey(visibleMonth || todayMonth, -1));
        else if (event.key === "ArrowRight") goToMonth(shiftMonthKey(visibleMonth || todayMonth, 1));
    }
</script>

<svelte:head><title>{isBudgetTab ? "Budget plans" : monthLabel} | Finance | stor</title></svelte:head>
<PageDataStatus resource={resource} />
<svelte:window onkeydown={handleKeydown}></svelte:window>

{#snippet financeNavigation()}
    <RouteTabs label="Finance views" tabs={financeTabs} />
{/snippet}

{#snippet financePeriod()}
    {#if !isBudgetTab}
        <div class="flex items-center justify-between gap-x-3 gap-y-2 sm:flex-wrap sm:justify-start sm:gap-x-5">
            <MonthNavigator
                year={year}
                month={month}
                currentYear={Number(todayMonth.slice(0, 4))}
                currentMonth={Number(todayMonth.slice(5, 7))}
                onNavigate={(targetYear, targetMonth) => goToMonth(`${targetYear}-${String(targetMonth).padStart(2, "0")}`)}
                compact
                phoneArrows={false}
                class="sm:w-auto"
            />
            <div class="mobile-scroll flex min-w-0 max-w-full items-center gap-2 overflow-x-auto">
                <nav class="stor-segmented-control inline-flex shrink-0" aria-label="Show">
                    {#each filters as option (option.id)}
                        <a
                            href={showHref(option.id)}
                            class="stor-segmented-option inline-flex min-h-11 items-center sm:min-h-9"
                            aria-current={show === option.id ? "page" : undefined}
                            data-state={show === option.id ? "active" : undefined}
                            data-sveltekit-reset="false"
                        >{option.label}{#if filterCount(option.id) !== null}<span class="stor-tab-count ml-1.5">{filterCount(option.id)}</span>{/if}</a>
                    {/each}
                </nav>
                {#if uncategorized > 0}
                    <CommandOnly>
                        <Button variant="secondary" size="sm" class="shrink-0" onclick={openSort}>Sort {uncategorized} uncategorized</Button>
                    </CommandOnly>
                {/if}
            </div>
        </div>
    {/if}
{/snippet}

<!-- On desktop the controls sit in the header; on smaller screens they head the view, which fills the screen. -->
{#snippet headerPeriod()}
    <div class="mt-3 hidden lg:block">{@render financePeriod()}</div>
{/snippet}

<!-- The transactions fit the screen at every size, so the list is the only thing that scrolls. -->
<div class="flex min-h-0 flex-col {isBudgetTab ? 'lg:h-full' : 'h-full'}">
    <PageHeader title="Finance" class="shrink-0 px-2.5 pt-2 pb-1 max-md:sr-only sm:px-3 sm:pt-4 sm:pb-2" sidebarTabs tabs={financeNavigation} context={headerPeriod}>
        {#if !isBudgetTab}
            <CommandOnly>
                <Button class="hidden lg:inline-flex" data-testid="open-transaction-drawer" onclick={() => openAddTransaction(undefined, show === "done" ? "archived" : "active")}>
                    <IconPlus class="h-4 w-4" /> {show === "done" ? "Record past transaction" : "Add transaction"}
                </Button>
            </CommandOnly>
        {/if}
    </PageHeader>

    {#if isBudgetTab}
        <BudgetPlans
            plans={view.budgetPlans}
            incomeItems={view.budgetIncomeItems}
            expenseItems={view.budgetExpenseItems}
            selectedPlanId={view.selectedPlanId}
            incomeSort={view.incomeSort}
            expenseSort={view.expenseSort}
        />
    {:else}
        <div class="flex min-h-0 flex-1 flex-col gap-2 px-2.5 pt-1 pb-2 sm:gap-3 sm:px-3 sm:pb-3">
            <!-- Phones keep these figures in the Outlook sheet behind the top bar's figure. -->
            <div class="hidden md:contents">
                <FinanceReadout
                    outlook={view.outlook}
                    today={today}
                    floor={floor}
                    assets={view.assets}
                    assetsSum={view.assetsSum}
                    onFloorChange={changeFloor}
                    onJump={(date) => void goToDate(date, "planned")}
                    onUpdateAssets={() => (assetsSheetOpen = true)}
                />
            </div>

            <div class="flex min-h-[18rem] flex-1 flex-col gap-2 sm:gap-3 lg:min-h-0">
                <div class="hidden shrink-0 md:block lg:hidden">{@render financePeriod()}</div>
                <!-- The list opens where the applied data says, so it waits for it. -->
                {#if displayResource.loading || !shown}
                    <section class="stor-panel flex-1 p-4" aria-label="Transactions">
                        <DataPlaceholder rows={8} label="Loading transactions" />
                    </section>
                {:else}
                    <!-- Below lg the list runs on under the page action, down to the dock. -->
                    <section
                        class="stor-panel flex min-h-0 flex-1 flex-col"
                        aria-label="Transactions"
                        data-under-action
                        data-phone-balance={phoneBalance ? "on" : "off"}
                        data-selecting={selectingNow ? "true" : "false"}
                        use:longPress={{ selector: "[data-row-id]", onLongPress: startSelecting }}
                        onclickcapture={selectingClick}
                    >
                        <!-- Phones: the month in view, what needs sorting, and the options; the list does the rest. -->
                        <div class="flex h-12 shrink-0 items-center gap-1.5 border-b border-[color-mix(in_srgb,var(--stor-border)_62%,transparent)] pl-2 pr-1 md:hidden">
                            <MonthNavigator
                                year={year}
                                month={month}
                                currentYear={Number(todayMonth.slice(0, 4))}
                                currentMonth={Number(todayMonth.slice(5, 7))}
                                onNavigate={(targetYear, targetMonth) => goToMonth(`${targetYear}-${String(targetMonth).padStart(2, "0")}`)}
                                compact
                                phoneArrows={false}
                                class="min-w-0"
                            />
                            {#if uncategorized > 0}
                                <CommandOnly>
                                    <button type="button" class="ml-auto h-8 shrink-0 rounded-full bg-[var(--stor-warning-soft)] px-3 text-[12.5px] font-semibold text-[var(--stor-warning)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--stor-focus)]" onclick={openSort}>{uncategorized} to sort</button>
                                </CommandOnly>
                            {/if}
                            <button
                                type="button"
                                class="relative flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-[var(--stor-muted-text)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--stor-focus)] {uncategorized > 0 ? '' : 'ml-auto'}"
                                aria-label="List options"
                                aria-haspopup="dialog"
                                data-testid="finance-list-options"
                                onclick={() => (optionsOpen = true)}
                            >
                                <IconTune class="h-5 w-5" />
                                {#if show !== "all" || phoneBalance}<span class="absolute right-2 top-2 h-2 w-2 rounded-full bg-[var(--stor-action)]" aria-hidden="true"></span>{/if}
                            </button>
                        </div>
                        <TransactionSelectionBar
                            selected={selectedRows}
                            visibleCount={visibleRows.length}
                            today={today}
                            onClear={clearSelection}
                            onSelectAll={selectAll}
                            onMove={async (rows, date) => { await moveTransactions(rows, date); clearSelection(); }}
                            onSetDone={async (rows, done) => {
                                const ids = rows.map((row) => row.id);
                                if (done) await markDone(ids);
                                else await restore(ids);
                                clearSelection();
                            }}
                            onDelete={async (rows) => { await removeTransactions(rows.map((row) => row.id)); clearSelection(); }}
                        />
                        <div class="min-h-0 flex-1">
                            {#key show}
                                <EndlessTimeline
                                    bind:this={timeline}
                                    store={months}
                                    today={today}
                                    anchor={openingDay}
                                    show={show}
                                    bounds={bounds}
                                    floor={floor}
                                    available={view.outlook.available}
                                    selectedIds={selectedIds}
                                    busyId={busyId}
                                    flashId={flashId}
                                    hoveredId={hoveredId}
                                    revision={revision}
                                    onSelect={selectRow}
                                    onEdit={openEditTransaction}
                                    onMarkDone={markRowDone}
                                    onRestore={restoreRow}
                                    onDelete={deleteRow}
                                    onHover={hoverRow}
                                    onVisibleChange={followVisible}
                                />
                            {/key}
                        </div>
                    </section>
                {/if}
            </div>
        </div>
    {/if}
</div>

{#if !isBudgetTab}
    <MobilePageAction hideWhenModalOpen isModalOpen={drawerOpen} hidden={selectedRows.length > 0 || selecting}>
        {#if !selecting}
            <Button class="text-[15px]" data-testid="open-transaction-drawer-mobile" onclick={() => openAddTransaction(undefined, show === "done" ? "archived" : "active")}>
                <IconPlus class="h-5 w-5" /> <span class="stor-action-label">{show === "done" ? "Record past transaction" : "Add transaction"}</span>
            </Button>
        {/if}
    </MobilePageAction>

    <PhoneGlance label={glance.label} value={glance.value} unit="Kč" tone={glance.tone} title="Outlook">
        <FinanceReadout
            sheet
            onUpdateAssets={() => (assetsSheetOpen = true)}
            outlook={view.outlook}
            today={today}
            floor={floor}
            assets={view.assets}
            assetsSum={view.assetsSum}
            onFloorChange={changeFloor}
        />
    </PhoneGlance>

    <AssetsSheet show={assetsSheetOpen} assets={view.assets} onClose={() => (assetsSheetOpen = false)} />

    <Modal show={optionsOpen} title="Show" onClose={() => (optionsOpen = false)}>
        <nav class="stor-segmented-control grid grid-cols-3" aria-label="Show">
            {#each filters as option (option.id)}
                <a
                    href={showHref(option.id)}
                    class="stor-segmented-option inline-flex min-h-11 items-center justify-center text-sm"
                    aria-current={show === option.id ? "page" : undefined}
                    data-state={show === option.id ? "active" : undefined}
                    data-sveltekit-reset="false"
                    onclick={() => (optionsOpen = false)}
                >{option.label}{#if filterCount(option.id) !== null}<span class="stor-tab-count ml-1.5">{filterCount(option.id)}</span>{/if}</a>
            {/each}
        </nav>
        <div class="mt-2 flex flex-col divide-y divide-[color-mix(in_srgb,var(--stor-border)_62%,transparent)]">
            <button type="button" class="flex min-h-16 items-center gap-3 text-left" role="switch" aria-checked={phoneBalance} onclick={togglePhoneBalance}>
                <span class="min-w-0 flex-1">
                    <span class="block text-[15px] font-medium text-[var(--stor-ink)]">Running balance</span>
                    <span class="block text-[12.5px] text-[var(--stor-muted-text)]">The balance after each plan and each month's figures</span>
                </span>
                <span class="relative h-[30px] w-12 shrink-0 rounded-full transition-colors {phoneBalance ? 'bg-[var(--stor-action)]' : 'bg-[var(--stor-surface-well)] shadow-[inset_0_0_0_1px_var(--stor-border)]'}" aria-hidden="true">
                    <span class="absolute top-[3px] h-6 w-6 rounded-full bg-white shadow transition-[left] {phoneBalance ? 'left-[21px]' : 'left-[3px]'}"></span>
                </span>
            </button>
            {#if uncategorized > 0}
                <CommandOnly>
                    <button type="button" class="flex min-h-16 w-full items-center gap-3 text-left" onclick={() => { optionsOpen = false; openSort(); }}>
                        <span class="min-w-0 flex-1">
                            <span class="block text-[15px] font-medium text-[var(--stor-ink)]">Sort {uncategorized} uncategorized</span>
                            <span class="block text-[12.5px] text-[var(--stor-muted-text)]">Give this month's transactions a category</span>
                        </span>
                        <IconChevronRight class="h-5 w-5 shrink-0 text-[var(--stor-muted-text)]" />
                    </button>
                </CommandOnly>
            {/if}
            <CommandOnly>
                <button type="button" class="flex min-h-16 w-full items-center gap-3 text-left" onclick={() => { optionsOpen = false; selecting = true; }}>
                    <span class="min-w-0 flex-1">
                        <span class="block text-[15px] font-medium text-[var(--stor-ink)]">Select transactions</span>
                        <span class="block text-[12.5px] text-[var(--stor-muted-text)]">Mark done, move or delete several. Or press and hold a row.</span>
                    </span>
                    <IconChevronRight class="h-5 w-5 shrink-0 text-[var(--stor-muted-text)]" />
                </button>
            </CommandOnly>
        </div>
    </Modal>
{/if}

<CommandOnly onUnavailable={() => drawerOpen = false}>
    {#if TransactionDrawer}
        <TransactionDrawer
            show={drawerOpen}
            initialDraft={drawerDraft}
            onClose={() => drawerOpen = false}
            onSave={saveTransaction}
            onDelete={deleteFromDrawer}
        />
    {/if}
</CommandOnly>

<SortUncategorizedSheet show={sortOpen} month={sortMonth} onClose={() => sortOpen = false} onApply={applyCategories} />
