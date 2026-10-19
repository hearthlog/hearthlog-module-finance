<script lang="ts">
    const drawerId = $props.id();
    const drawerFormId0 = drawerId + "-0";

    import { Drawer } from "@hearthlog/sdk/ui";
    import { AmountField, Button, Field } from "@hearthlog/sdk/ui";
    import { DatePicker } from "@hearthlog/sdk/ui";
    import { Input } from "@hearthlog/sdk/ui";
    import { Label } from "@hearthlog/sdk/ui";
    import type { SelectOption } from "@hearthlog/sdk/ui";
    import { Checkbox } from "@hearthlog/sdk/ui";
    import { CommandConfirmDialog } from "@hearthlog/sdk/ui";
    import { SuggestButton } from "@hearthlog/sdk/ui";
    import { SuggestionChip } from "@hearthlog/sdk/ui";
    import { SuggestionMark } from "@hearthlog/sdk/ui";
    import { categoryLabel, TRANSACTION_CATEGORIES } from "../../finance/categories.js";
    import { categorySource, suggestCategoriesDetailed, type CategorySuggestion } from "../../finance/category-suggestions.js";
    import { isAiCapabilityEnabled } from "@hearthlog/sdk/runtime";
    import { canMarkHappened, defaultHappened, expandDraft, formatDayRange, isDoneAhead, isRepeatDays, MAX_REPEAT_DAYS, resolveDraftStatus, type TransactionDraft } from "./transaction-draft.js";
    import { appClock } from "@hearthlog/sdk/runtime";
    import { formatMoney } from "@hearthlog/sdk/format";
    import { addDays, format, parseISO } from "date-fns";
    import { tick } from "svelte";
    import { queryDatabase } from "@hearthlog/sdk/data";
    import IconChevronDown from "~icons/mdi/chevron-down";
    import IconCalendar from "~icons/mdi/calendar-month-outline";
    import { Switch } from "@hearthlog/sdk/ui";

    let {
        show,
        initialDraft,
        onClose,
        onSave,
        onDelete,
    }: {
        show: boolean;
        initialDraft: TransactionDraft;
        onClose: () => void;
        /** Saves one transaction, or one per day for a daily repeat. */
        onSave: (drafts: TransactionDraft[]) => Promise<void>;
        /** Deletes the transaction being edited. */
        onDelete?: () => Promise<void>;
    } = $props();

    let confirmDelete = $state(false);
    // Phones put the amount first with the number pad, offer days and categories as chips, and fold Repeat.
    // The phone form layout is the form layout at every width (docs/design-concepts/desktop-backport-2026-10-05).
    const phone = { current: true };
    let moreOpen = $state(false);
    let pickDate = $state(false);
    let allCategories = $state(false);
    const chip = (on: boolean) => `h-9 rounded-full px-3.5 text-sm font-medium ${on ? "bg-[var(--stor-accent-soft)] font-semibold text-[var(--stor-accent-strong)]" : "bg-[var(--stor-surface-muted)] text-[var(--stor-ink)]"}`;
    let topCategories = $state<string[]>([]);

    let form = $state<TransactionDraft>({
        name: "",
        amount: 0,
        dueDate: "",
        category: "unknown",
        status: "active",
        direction: "expense",
    });
    let saving = $state(false);
    const today = $derived(show ? format(appClock.now(), "yyyy-MM-dd") : "");
    // Earlier days are done by their date; an entry for today asks whether it
    // already happened. An explicit choice sticks while the date changes.
    let happenedChoice = $state<boolean | null>(null);
    const alreadyHappened = $derived(happenedChoice ?? defaultHappened(initialDraft.status));
    const doneAhead = $derived(isDoneAhead(initialDraft, today));
    const resolvedStatus = $derived(resolveDraftStatus(form, today, alreadyHappened, doneAhead));
    // New transactions can repeat daily: one transaction per day, same values.
    let repeatDaily = $state(false);
    let repeatDays = $state<number | null>(7);
    const repeating = $derived(!initialDraft.id && repeatDaily);
    const days = $derived(repeating ? Number(repeatDays) : 1);
    const entries = $derived(expandDraft(form, days, today, alreadyHappened, doneAhead));
    const canHappen = $derived(entries.some((entry) => canMarkHappened(entry, today)));
    const series = $derived(repeating && entries.length > 1);
    const anyDone = $derived(entries.some((entry) => entry.status === "archived"));
    const allDone = $derived(entries.every((entry) => entry.status === "archived"));
    const seriesSummary = $derived(series
        ? `${entries.length} transactions · ${formatMoney(Math.abs(Number(form.amount) || 0) * entries.length)} · ${formatDayRange(entries[0].dueDate, entries[entries.length - 1].dueDate)}`
        : "");
    const happenedHint = $derived(
        series
            ? "Record today’s entry as done. Unchecked, it stays planned for today."
            : "Record it as done. Unchecked, it stays planned for today.",
    );
    const phoneAmount = $derived(Math.abs(Number(form.amount)) || 0);
    const saveLabel = $derived(
        initialDraft.id
            ? "Save changes"
            : phone.current && !series && phoneAmount > 0
                ? `${resolvedStatus === "archived" ? "Record" : "Plan"} ${formatMoney(form.direction === "expense" ? -phoneAmount : phoneAmount)}`
            : series
                ? `${allDone ? "Record" : anyDone ? "Add" : "Plan"} ${entries.length} transactions`
                : resolvedStatus === "archived" ? "Record transaction" : "Plan transaction",
    );
    let errorMessage = $state("");
    let loadedKey = "";
    const AUTO_SUGGEST_DELAY_MS = 700;

    const categoryOptions: SelectOption[] = TRANSACTION_CATEGORIES.map(({ value, label }) => ({ value, label }));

    // A category is suggested once the name is known, while it is still
    // Uncategorized and untouched. A suggestion only fills the field; Save is
    // the only write, and choosing a category yourself removes the tag.
    let categoryTouched = $state(false);
    let appliedSuggestion = $state<CategorySuggestion | null>(null);
    let offeredSuggestion = $state<CategorySuggestion | null>(null);
    let suggestionRun = 0;
    let lastAsked = "";
    /** What the Suggest button is doing, or why it found nothing. */
    let suggestState = $state<"idle" | "busy" | "none" | "unavailable">("idle");
    const aiEnabled = isAiCapabilityEnabled("category-pick");

    function resetSuggestion(): void {
        suggestionRun += 1;
        categoryTouched = false;
        appliedSuggestion = null;
        offeredSuggestion = null;
        lastAsked = "";
        suggestState = "idle";
    }

    function applySuggestion(suggestion: CategorySuggestion): void {
        form.category = suggestion.category;
        form.categorySource = categorySource(suggestion.origin);
        appliedSuggestion = suggestion;
        offeredSuggestion = null;
    }

    function chooseCategory(value: string): void {
        suggestionRun += 1;
        suggestState = "idle";
        categoryTouched = true;
        appliedSuggestion = null;
        offeredSuggestion = null;
        form.category = value;
        form.categorySource = value === "unknown" ? "" : "manual";
    }

    /** Asks for a suggestion. The automatic ask (`manual` false) is quiet; the button explains its result. */
    async function suggest(manual = false): Promise<void> {
        const name = form.name.trim();
        if (!show || !name) return;
        const unsettled = !categoryTouched && form.category === "unknown";
        if (!manual && !unsettled) return;
        const amount = Math.abs(Number(form.amount)) || 0;
        const key = `${name}|${amount}|${form.direction}`;
        if (!manual && key === lastAsked) return;
        lastAsked = key;
        const run = ++suggestionRun;
        if (manual) {
            suggestState = "busy";
            appliedSuggestion = null;
            offeredSuggestion = null;
        }
        const result = await suggestCategoriesDetailed([{ id: "draft", name, amount, direction: form.direction }]).catch(() => null);
        // An answer that arrives after the user chose a category or closed the drawer is dropped.
        if (run !== suggestionRun || !show) return;
        if (!manual && (categoryTouched || form.category !== "unknown")) return;
        const found = result?.suggestions.get("draft");
        if (manual) suggestState = found ? "idle" : !result || result.aiUnavailable ? "unavailable" : "none";
        if (!found) return;
        if (found.origin.kind === "ai" && found.origin.band === "offer") offeredSuggestion = found;
        else applySuggestion(found);
    }

    $effect(() => {
        const key = `${show}:${initialDraft.id ?? "new"}:${initialDraft.dueDate}`;
        // Closing forgets the loaded draft, so the next new transaction on the same day starts clean.
        if (!show) loadedKey = "";
        if (show && key !== loadedKey) {
            loadedKey = key;
            form = { ...initialDraft };
            happenedChoice = null;
            repeatDaily = false;
            repeatDays = 7;
            errorMessage = "";
            moreOpen = false;
            pickDate = false;
            allCategories = false;
            resetSuggestion();
        }
    });

    // The categories used most in the last 90 days for this direction, counted in SQL.
    $effect(() => {
        const direction = form.direction;
        if (!show || !phone.current) return;
        let current = true;
        const since = format(addDays(appClock.now(), -90), "yyyy-MM-dd");
        void queryDatabase((repositories) => repositories.transactions.getTopCategories(since, direction))
            .then((categories) => { if (current) topCategories = categories; })
            .catch(() => undefined);
        return () => { current = false; };
    });
    const categoryChips = $derived.by(() => {
        const chips = topCategories.slice(0, 4);
        if (form.category !== "unknown" && !chips.includes(form.category)) chips.unshift(form.category);
        return chips;
    });
    const tomorrow = $derived(today ? format(addDays(parseISO(today), 1), "yyyy-MM-dd") : "");
    const otherDay = $derived(!!form.dueDate && form.dueDate !== today && form.dueDate !== tomorrow);

    $effect(() => {
        if (!show) suggestionRun += 1;
    });

    // Ask a moment after typing stops. Blur asks at once; the same name and amount is never asked twice.
    $effect(() => {
        void form.amount;
        void form.direction;
        if (!show || form.name.trim().length < 3) return;
        const timer = setTimeout(() => void suggest(), AUTO_SUGGEST_DELAY_MS);
        return () => clearTimeout(timer);
    });

    $effect(() => {
        if (!show) return;
        let focusFrame = 0;
        let settleFrame = 0;
        void tick().then(() => {
            focusFrame = requestAnimationFrame(() => {
                settleFrame = requestAnimationFrame(() => {
                    document.querySelector<HTMLInputElement>(
                        phone.current && !initialDraft.id ? '[data-testid="transaction-amount"]' : '[data-testid="transaction-name"]',
                    )?.focus();
                });
            });
        });
        return () => {
            cancelAnimationFrame(focusFrame);
            cancelAnimationFrame(settleFrame);
        };
    });

    async function submit(event: SubmitEvent) {
        event.preventDefault();
        if (saving) return;
        if (!form.name.trim()) {
            errorMessage = "Enter a transaction name.";
            return;
        }
        if (!Number.isFinite(Number(form.amount)) || Number(form.amount) === 0) {
            errorMessage = "Enter a non-zero amount.";
            return;
        }
        if (!form.dueDate) {
            errorMessage = "Choose a transaction date.";
            return;
        }
        if (repeating && !isRepeatDays(days)) {
            errorMessage = `Repeat for 2 to ${MAX_REPEAT_DAYS} days.`;
            return;
        }

        saving = true;
        errorMessage = "";
        try {
            await onSave(expandDraft({
                ...form,
                name: form.name.trim(),
                amount: form.direction === "expense" ? -Math.abs(Number(form.amount)) : Math.abs(Number(form.amount)),
            }, days, today, alreadyHappened, doneAhead));
        } catch (error) {
            errorMessage =
                error instanceof Error
                    ? error.message
                    : "The transaction could not be saved.";
        } finally {
            saving = false;
        }
    }
</script>

<Drawer
    {show}
    title={initialDraft.id ? "Edit transaction" : initialDraft.status === "archived" ? "Record past transaction" : "New transaction"}
    {onClose}
>
    <form id={drawerFormId0} class="flex flex-col gap-4" onsubmit={submit}>
        <Label class="block max-md:order-2">
            Name
            <Input
                autofocus
                data-testid="transaction-name"
                type="text"
                bind:value={form.name}
                placeholder="Rent, salary, groceries..."
                class="mt-1.5"
                onblur={() => void suggest()}
            />
        </Label>

        <Field class="max-md:order-1" label="Amount" htmlFor="{drawerId}-amount" labelClass="max-md:sr-only" hintClass="max-md:hidden" hint="Type 1200+84 to add. Expense or Income sets the direction.">
            <AmountField
                id="{drawerId}-amount"
                data-testid="transaction-amount"
                bind:value={() => form.amount || null, (value) => (form.amount = value ?? 0)}
                bind:direction={form.direction}
                onblur={() => void suggest()}
            />
        </Field>

        <div class="grid gap-3 max-md:order-3 sm:grid-cols-2">
            <div class="block">
                <span class="text-sm font-medium text-[var(--stor-ink)]" id="{drawerId}-day">Date</span>
                <div class="mt-1.5 flex flex-wrap gap-2" role="group" aria-labelledby="{drawerId}-day">
                    <button type="button" class={chip(form.dueDate === today)} aria-pressed={form.dueDate === today} onclick={() => { form.dueDate = today; pickDate = false; }}>Today</button>
                    <button type="button" class={chip(form.dueDate === tomorrow)} aria-pressed={form.dueDate === tomorrow} onclick={() => { form.dueDate = tomorrow; pickDate = false; }}>Tomorrow</button>
                    <button type="button" class="{chip(otherDay)} inline-flex items-center gap-1.5" aria-expanded={pickDate} onclick={() => (pickDate = !pickDate)}>
                        <IconCalendar class="h-4 w-4" />{otherDay ? format(parseISO(form.dueDate), "EEE d MMM") : "Pick date"}
                    </button>
                </div>
                {#if pickDate}
                    <DatePicker
                        bind:value={form.dueDate}
                        class="mt-2 text-sm"
                        placeholder="Choose transaction date"
                    />
                {/if}
            </div>
            <div class="block">
                <div class="flex items-center justify-between gap-2">
                    <Label>Category</Label>
                    {#if aiEnabled}
                        <SuggestButton label="Suggest a category" busy={suggestState === "busy"} disabled={!form.name.trim()} onclick={() => void suggest(true)} />
                    {/if}
                </div>
                <!-- The most used categories, then All for the full list; one list, not chips and a select. -->
                <div class="mt-1.5 flex flex-wrap gap-2" role="group" aria-label="Categories">
                    {#each allCategories ? categoryOptions.map((option) => option.value) : categoryChips as value (value)}
                        <button type="button" class={chip(form.category === value)} aria-pressed={form.category === value} onclick={() => chooseCategory(value)}>{categoryLabel(value)}</button>
                    {/each}
                    {#if !allCategories}
                        <button type="button" class="{chip(false)} inline-flex items-center gap-1" onclick={() => (allCategories = true)}>All<IconChevronDown class="h-4 w-4" /></button>
                    {/if}
                </div>
                <div class="mt-1.5 flex min-h-5 items-center" aria-live="polite">
                    {#if appliedSuggestion}
                        <SuggestionMark
                            kind={appliedSuggestion.origin.kind}
                            reason={appliedSuggestion.origin.kind === "history" ? `Same as ${appliedSuggestion.origin.count} earlier` : ""}
                        />
                    {:else if offeredSuggestion}
                        <SuggestionChip label={categoryLabel(offeredSuggestion.category)} onclick={() => { if (offeredSuggestion) { categoryTouched = true; applySuggestion(offeredSuggestion); } }} />
                    {:else if suggestState === "none"}
                        <span class="text-[11px] leading-4 text-[var(--stor-muted-text)]">No suggestion for this name.</span>
                    {:else if suggestState === "unavailable"}
                        <span class="text-[11px] leading-4 text-[var(--stor-muted-text)]">Suggestions aren’t available right now.</span>
                    {/if}
                </div>
            </div>
        </div>

        {#if !initialDraft.id && phone.current && !moreOpen}
            <button type="button" class="flex items-center gap-1 self-start text-sm font-semibold text-[var(--stor-accent-text)] max-md:order-5" aria-expanded="false" onclick={() => (moreOpen = true)}>
                Repeat<IconChevronDown class="h-4 w-4" />
            </button>
        {:else if !initialDraft.id}
            <div class="grid gap-3 max-md:order-5 sm:grid-cols-2">
                <div class="block">
                    <Label id="{drawerId}-repeat">Repeat</Label>
                    <div class="stor-segmented-control mt-1.5 grid grid-cols-2 sm:h-9" role="group" aria-labelledby="{drawerId}-repeat">
                        <button type="button" class="stor-segmented-option min-h-11 sm:min-h-0" aria-pressed={!repeatDaily} onclick={() => (repeatDaily = false)}>Once</button>
                        <button type="button" class="stor-segmented-option min-h-11 sm:min-h-0" aria-pressed={repeatDaily} onclick={() => (repeatDaily = true)}>Daily</button>
                    </div>
                </div>
                {#if repeatDaily}
                    <Label class="block">
                        Days
                        <Input
                            data-testid="transaction-repeat-days"
                            type="number"
                            inputmode="numeric"
                            min="2"
                            max={MAX_REPEAT_DAYS}
                            step="1"
                            bind:value={repeatDays}
                            class="mt-1.5"
                        />
                    </Label>
                {/if}
            </div>
            {#if seriesSummary}
                <p class="text-xs leading-5 text-[var(--stor-muted-text)] max-md:order-5" data-testid="transaction-repeat-summary">{seriesSummary}</p>
            {/if}
        {/if}

        {#if canHappen && phone.current}
            <Switch
                class="max-md:order-4"
                checked={alreadyHappened}
                label="Already happened"
                hint={alreadyHappened ? "Recorded as done" : series ? "Off: today's entry stays a plan" : "Off: it stays a plan for today"}
                onCheckedChange={(value) => (happenedChoice = value)}
            />
        {:else if canHappen}
            <label class="flex cursor-pointer items-start gap-3 rounded-xl bg-[var(--stor-surface-muted)] px-3 py-2.5" for="transaction-already-happened">
                <Checkbox id="transaction-already-happened" checked={alreadyHappened} onCheckedChange={(value) => (happenedChoice = value === true)} class="mt-0.5" aria-describedby="transaction-already-happened-hint" />
                <span class="min-w-0">
                    <span class="block text-sm font-semibold text-[var(--stor-ink)]">Already happened</span>
                    <span id="transaction-already-happened-hint" class="block text-xs leading-5 text-[var(--stor-muted-text)]">{happenedHint}</span>
                </span>
            </label>
        {/if}

        {#if !initialDraft.id && anyDone}
            <div class="rounded-xl bg-[var(--stor-info-soft)] px-3 py-2 max-md:order-6 text-xs leading-5 text-[var(--stor-muted-text)]">Done transactions go straight to history and don’t change your current assets.</div>
        {/if}

        {#if errorMessage}
            <div class="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 max-md:order-7" role="alert">
                {errorMessage}
            </div>
        {/if}

        </form>
    {#snippet footer()}
            {#if initialDraft.id && onDelete}
                <Button
                    variant="ghost"
                    size="sm"
                    class="mr-auto text-[var(--stor-negative)]"
                    onclick={() => (confirmDelete = true)}
                    disabled={saving}
                >
                    Delete
                </Button>
            {/if}
            <Button
                variant="secondary"
                size="sm"
                onclick={onClose}
                disabled={saving}
            >
                Cancel
            </Button>
            <Button
                type="submit" form={drawerFormId0}
                data-testid="save-transaction"
                disabled={saving}
            >
                {saving ? "Saving..." : saveLabel}
            </Button>

    {/snippet}
</Drawer>

<CommandConfirmDialog
    show={confirmDelete}
    title="Delete transaction"
    message={`Delete “${form.name || "this transaction"}”?`}
    onConfirm={async () => {
        confirmDelete = false;
        saving = true;
        try {
            await onDelete?.();
        } catch {
            errorMessage = "The transaction could not be deleted.";
        } finally {
            saving = false;
        }
    }}
    onCancel={() => (confirmDelete = false)}
/>
