<script lang="ts">
    import { format, parseISO } from "date-fns";
    import type { BudgetItem } from "@hearthlog/sdk/data";
    import { formatMoney } from "@hearthlog/sdk/format";
    import { Button, ChoiceChips, Drawer, Input, Label } from "@hearthlog/sdk/ui";
    import {
        clampDayOfMonth,
        nextRecurringDates,
        type RecurringCadence,
        type RecurringRule,
    } from "../../finance/recurring.js";
    import { categoryLabel } from "../../finance/categories.js";

    let {
        show,
        item,
        rule,
        today,
        onClose,
        onSave,
    }: {
        show: boolean;
        item: BudgetItem | null;
        rule: RecurringRule | null;
        today: string;
        onClose: () => void;
        onSave: (item: BudgetItem, nextRule: RecurringRule) => Promise<void>;
    } = $props();

    let enabled = $state(true);
    let cadence = $state<RecurringCadence>("monthly");
    let dayOfMonth = $state(1);
    let saving = $state(false);
    let loadedKey = "";

    $effect(() => {
        const key = `${show}:${item?.id ?? ""}`;
        if (!show) loadedKey = "";
        if (!show || !item || key === loadedKey) return;
        loadedKey = key;
        enabled = rule ? rule.enabled : true;
        cadence = rule?.cadence ?? "monthly";
        dayOfMonth = rule?.dayOfMonth ?? (today ? Number(today.slice(8, 10)) || 1 : 1);
    });

    const draftRule = $derived<RecurringRule>({
        enabled,
        cadence,
        dayOfMonth: clampDayOfMonth(dayOfMonth),
    });

    const previewDates = $derived(enabled && today ? nextRecurringDates(draftRule, today, 3) : []);

    async function submit(event: SubmitEvent): Promise<void> {
        event.preventDefault();
        if (!item || saving) return;
        saving = true;
        try {
            await onSave(item, draftRule);
            onClose();
        } finally {
            saving = false;
        }
    }
</script>

<Drawer {show} title="Recurring schedule" onClose={onClose}>
    {#if item}
        <form class="flex flex-col gap-4" onsubmit={submit}>
            <div class="rounded-xl border border-[var(--stor-hairline)] bg-[var(--stor-surface-muted)] p-3.5">
                <div class="text-sm font-semibold text-[var(--stor-ink)]">{item.name}</div>
                <div class="mt-0.5 text-xs text-[var(--stor-muted-text)]">
                    {formatMoney(Number(item.amount))} · {categoryLabel(item.category)}
                </div>
            </div>

            <div class="flex items-center justify-between gap-3 rounded-xl border border-[var(--stor-hairline)] bg-[var(--stor-surface)] px-3.5 py-3">
                <div>
                    <div class="text-sm font-medium text-[var(--stor-ink)]">Auto-populate Cash Flow</div>
                    <div class="text-xs text-[var(--stor-muted-text)]">Creates upcoming planned rows on the timeline</div>
                </div>
                <button
                    type="button"
                    role="switch"
                    aria-checked={enabled}
                    aria-label="Enable recurring schedule"
                    class="relative h-6 w-10 shrink-0 rounded-full transition-colors {enabled ? 'bg-[var(--stor-action)]' : 'bg-[var(--stor-surface-well)] shadow-[inset_0_0_0_1px_var(--stor-border)]'}"
                    onclick={() => (enabled = !enabled)}
                >
                    <span class="absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-[left] {enabled ? 'left-[18px]' : 'left-0.5'}"></span>
                </button>
            </div>

            {#if enabled}
                <div class="flex flex-col gap-1.5">
                    <Label>Cadence</Label>
                    <ChoiceChips
                        value={cadence}
                        options={[
                            { value: "monthly", label: "Monthly" },
                            { value: "quarterly", label: "Quarterly" },
                            { value: "yearly", label: "Yearly" },
                        ]}
                        onValueChange={(value) => {
                            if (value === "monthly" || value === "quarterly" || value === "yearly") cadence = value;
                        }}
                    />
                </div>

                <div class="flex flex-col gap-1.5">
                    <Label for="recurring-day">Day of month (1–31)</Label>
                    <Input
                        id="recurring-day"
                        type="number"
                        min={1}
                        max={31}
                        value={String(dayOfMonth)}
                        oninput={(event) => {
                            const parsed = Number((event.currentTarget as HTMLInputElement).value);
                            if (Number.isFinite(parsed)) dayOfMonth = clampDayOfMonth(parsed);
                        }}
                    />
                </div>

                <div class="rounded-xl border border-[var(--stor-hairline)] bg-[var(--stor-surface-muted)] p-3.5">
                    <div class="text-[11px] font-semibold uppercase tracking-wider text-[var(--stor-muted-text)]">
                        Next 3 dates on Cash Flow
                    </div>
                    <ul class="mt-2 space-y-1 text-xs text-[var(--stor-ink)]">
                        {#each previewDates as iso (iso)}
                            <li class="flex items-center justify-between">
                                <span>{format(parseISO(iso), "d MMM yyyy")}</span>
                                <strong class="tabular-nums {item.item_type === 'income' ? 'text-[var(--stor-positive)]' : ''}">
                                    {item.item_type === "income" ? "+" : "−"}{formatMoney(Math.abs(Number(item.amount)))}
                                </strong>
                            </li>
                        {/each}
                    </ul>
                </div>
            {/if}

            <div class="mt-2 flex items-center gap-2">
                <Button type="submit" class="flex-1" disabled={saving}>
                    {saving ? "Saving…" : enabled ? "Save & schedule" : "Save as plan only"}
                </Button>
                <Button type="button" variant="secondary" onclick={onClose}>Cancel</Button>
            </div>
        </form>
    {/if}
</Drawer>
