<script module lang="ts">
    import type { TimelineKind } from "../../finance/timeline.js";

    export type RowLike = {
        id: string;
        name: string;
        amount: number;
        date: string;
        category: string;
        kind: TimelineKind;
    };
    export type BalanceTone = "default" | "low" | "below";
</script>

<script lang="ts">
    import type { Snippet } from "svelte";
    import { DropdownMenu } from "bits-ui";
    import { format, parseISO } from "date-fns";
    import { categoryLabel } from "../../finance/categories.js";
    import { formatAmount } from "@hearthlog/sdk/format";
    import { CommandOnly } from "@hearthlog/sdk/ui";
    import { CommandConfirmDialog } from "@hearthlog/sdk/ui";
    import { SyncStateBadge } from "@hearthlog/sdk/ui";
    import IconCheck from "~icons/mdi/check";
    import IconDots from "~icons/mdi/dots-horizontal";

    let {
        row,
        today,
        firstOfDay = false,
        divider = false,
        balance = null,
        balanceTone = "default",
        showDate = true,
        compact = false,
        selectable = true,
        selected = false,
        busy = false,
        highlighted = false,
        flash = false,
        onSelect,
        onEdit,
        onMarkDone,
        onRestore,
        onDelete,
        onHover,
        gutter,
    }: {
        row: RowLike;
        today: string;
        firstOfDay?: boolean;
        /** A hairline above the first row of a day that follows another day. */
        divider?: boolean;
        /** The running balance after this row, for plans. */
        balance?: number | null;
        balanceTone?: BalanceTone;
        showDate?: boolean;
        /** Stacked layout for narrow side panels. */
        compact?: boolean;
        selectable?: boolean;
        selected?: boolean;
        busy?: boolean;
        highlighted?: boolean;
        flash?: boolean;
        onSelect?: (row: RowLike, selected: boolean) => void;
        onEdit?: (row: RowLike) => void;
        onMarkDone?: (row: RowLike) => void | Promise<void>;
        onRestore?: (row: RowLike) => void | Promise<void>;
        onDelete?: (row: RowLike) => void | Promise<void>;
        onHover?: (row: RowLike | null) => void;
        /** Drawn in the river gutter to the left of the row. */
        gutter?: Snippet;
    } = $props();

    let confirmDelete = $state(false);
    const day = $derived(parseISO(row.date));
    /** Today's plan can leave the outlook early; tomorrow it is done anyway. */
    const markable = $derived(row.kind === "planned" && row.date === today);
    /** Only a row done ahead of its day can go back to plans; earlier days are done by date. */
    const restorable = $derived(row.kind === "done" && row.date >= today);
    const name = $derived(row.name || "Untitled");
    const balanceTitle = $derived(
        balanceTone === "low" || balanceTone === "below" ? "Lowest balance ahead"
            : "Balance after this plan",
    );
</script>

<div
    class="timeline-row"
    class:divider
    class:no-date={!showDate}
    class:no-check={!selectable}
    class:compact
    class:done={row.kind === "done"}
    class:selected
    class:highlighted
    class:flash
    data-row-id={row.id}
    data-kind={row.kind}
    data-date={row.date}
    role="group"
    aria-label={name}
    onmouseenter={() => onHover?.(row)}
    onmouseleave={() => onHover?.(null)}
>
    {#if gutter}<div class="gutter" data-river>{@render gutter()}</div>{/if}
    <div class="cell-check" data-row-check>
        {#if selectable}
            <label class="check-hit">
                <input
                    type="checkbox"
                    class="h-4 w-4 rounded border-[var(--stor-field-border)] accent-[var(--stor-action)]"
                    checked={selected}
                    aria-label={`Select ${name}`}
                    onchange={(event) => onSelect?.(row, event.currentTarget.checked)}
                />
            </label>
        {/if}
    </div>
    <div class="cell-date" aria-hidden="true">
        {#if showDate && firstOfDay}<b>{format(day, "d")}</b><span>{format(day, "EEE")}</span>{/if}
    </div>
    <button type="button" class="cell-main" onclick={() => onEdit?.(row)}>
        <span class="name-line"><span class="name">{name}</span><SyncStateBadge entityId={`transaction:${row.id}`} /></span>
        <span class="category">{categoryLabel(row.category)}</span>
    </button>
    <div class="cell-amount" class:income={row.amount > 0}>{formatAmount(row.amount, { signed: true })}</div>
    <div class="cell-end">
        {#if markable}
            <CommandOnly>
                <button type="button" class="done-button" disabled={busy} aria-label={`Mark ${name} done`} onclick={() => void onMarkDone?.(row)}>
                    <IconCheck class="h-3.5 w-3.5" />Done
                </button>
            </CommandOnly>
        {:else if balance !== null}
            <span class="balance {balanceTone}" title={balanceTitle} data-balance>{formatAmount(balance)}</span>
        {:else if row.kind === "done"}
            <span class="done-mark" title="Done"><IconCheck class="h-4 w-4" /><span class="sr-only">Done</span></span>
        {/if}
    </div>
    <div class="cell-menu">
        <CommandOnly>
            <DropdownMenu.Root>
                <DropdownMenu.Trigger
                    class="flex h-9 w-9 items-center justify-center rounded-lg text-[var(--stor-muted-text)] hover:bg-[var(--stor-surface-muted)] hover:text-[var(--stor-ink)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--stor-focus)] disabled:opacity-40"
                    aria-label={`Actions for ${name}`}
                    disabled={busy}
                >
                    <IconDots class="h-4.5 w-4.5" />
                </DropdownMenu.Trigger>
                <DropdownMenu.Portal>
                    <DropdownMenu.Content side="bottom" align="end" sideOffset={4} loop class="stor-menu z-[var(--stor-layer-menu)] w-44 overflow-hidden py-1">
                        <DropdownMenu.Item class="cursor-default px-3 py-1.5 text-sm text-[var(--stor-ink)] outline-none data-[highlighted]:bg-[var(--stor-surface-muted)]" onSelect={() => onEdit?.(row)}>
                            Edit details
                        </DropdownMenu.Item>
                        {#if row.kind === "planned" || restorable}
                            <DropdownMenu.Item
                                class="cursor-default px-3 py-1.5 text-sm text-[var(--stor-ink)] outline-none data-[highlighted]:bg-[var(--stor-surface-muted)]"
                                onSelect={() => void (restorable ? onRestore?.(row) : onMarkDone?.(row))}
                            >
                                {restorable ? "Restore to plans" : "Mark done"}
                            </DropdownMenu.Item>
                        {/if}
                        <DropdownMenu.Item class="cursor-default px-3 py-1.5 text-sm text-[var(--stor-negative)] outline-none data-[highlighted]:bg-[var(--stor-negative-soft)]" onSelect={() => (confirmDelete = true)}>
                            Delete
                        </DropdownMenu.Item>
                    </DropdownMenu.Content>
                </DropdownMenu.Portal>
            </DropdownMenu.Root>
        </CommandOnly>
    </div>
</div>

<CommandConfirmDialog
    show={confirmDelete}
    title="Delete transaction"
    message={`Delete “${name}”?`}
    onConfirm={async () => {
        confirmDelete = false;
        await onDelete?.(row);
    }}
    onCancel={() => (confirmDelete = false)}
/>

<style>
    .timeline-row {
        --check: 2.25rem;
        --date: 2.25rem;
        --gap: 0.625rem;
        position: relative;
        display: grid;
        grid-template-columns: var(--check) var(--date) minmax(0, 1fr) auto 6.25rem 2.25rem;
        grid-template-areas: "check date main amount end menu";
        align-items: center;
        column-gap: var(--gap);
        min-height: 2.75rem;
        padding: 0 0.5rem 0 calc(var(--river, 0px) + 0.25rem);
        transition: background-color 120ms ease;
    }
    .timeline-row.no-date { --date: 0px; }
    .timeline-row.divider::before {
        content: "";
        position: absolute;
        top: 0;
        right: 0.5rem;
        left: calc(var(--river, 0px) + 0.25rem + var(--lead, calc(var(--check) + var(--date) + var(--gap) * 2)));
        border-top: 1px solid color-mix(in srgb, var(--stor-border) 62%, transparent);
    }
    .timeline-row.compact {
        grid-template-columns: var(--check) var(--date) minmax(0, 1fr) auto 2.25rem;
        grid-template-areas: "check date main amount menu" "check date main end menu";
        min-height: 3.25rem;
    }
    .timeline-row.compact.no-check {
        --lead: calc(1rem + var(--date) + var(--gap));
        grid-template-columns: var(--date) minmax(0, 1fr) auto 2.25rem;
        grid-template-areas: "date main amount menu" "date main end menu";
        padding-left: calc(var(--river, 0px) + 1.25rem);
    }
    .timeline-row.compact.no-check.no-date {
        --lead: 1rem;
        grid-template-columns: minmax(0, 1fr) auto 2.25rem;
        grid-template-areas: "main amount menu" "main end menu";
    }
    .compact.no-check .cell-check, .compact.no-date .cell-date { display: none; }
    .compact .cell-main { flex-direction: column; align-items: stretch; justify-content: center; gap: 1px; padding: 0.5rem 0; }
    .compact .cell-amount { align-self: end; padding-top: 0.5rem; }
    .compact .cell-end { align-self: start; padding-bottom: 0.5rem; }
    .timeline-row:hover,
    .timeline-row.highlighted {
        background: linear-gradient(to right, transparent var(--river, 0px), var(--stor-surface-hover) var(--river, 0px));
    }
    .timeline-row.selected {
        background: linear-gradient(to right, transparent var(--river, 0px), var(--stor-selected) var(--river, 0px));
    }
    .timeline-row.flash { animation: row-flash 1.8s ease-out; }
    @keyframes row-flash {
        from { background-color: var(--stor-selected); }
        to { background-color: transparent; }
    }
    .gutter { position: absolute; top: 0; bottom: 0; left: 0; width: var(--river, 0px); }
    .cell-check { grid-area: check; align-self: stretch; }
    .check-hit { display: flex; height: 100%; min-height: 2.75rem; align-items: center; justify-content: center; cursor: pointer; }
    .cell-date { grid-area: date; display: flex; flex-direction: column; line-height: 1.05; font-family: var(--stor-font-mono); }
    .cell-date b { font-size: 13px; font-weight: 600; color: var(--stor-ink); }
    .cell-date span { font-size: 10px; font-weight: 500; letter-spacing: 0.04em; text-transform: uppercase; color: var(--stor-muted-text); }
    .cell-main {
        grid-area: main;
        display: flex;
        min-width: 0;
        min-height: 2.75rem;
        align-items: baseline;
        align-self: stretch;
        gap: 0.5rem;
        padding: 0.75rem 0;
        border: 0;
        background: transparent;
        text-align: left;
        border-radius: 8px;
    }
    button.cell-main:focus-visible { outline: 2px solid var(--stor-focus); outline-offset: -2px; }
    button.cell-main:hover .name { text-decoration: underline; text-decoration-color: var(--stor-border); text-underline-offset: 3px; }
    .name-line { display: inline-flex; min-width: 0; align-items: center; gap: 0.375rem; }
    .name { overflow: hidden; min-width: 0; font-size: 13.5px; font-weight: 500; color: var(--stor-ink); text-overflow: ellipsis; white-space: nowrap; }
    .category { flex: none; font-size: 12px; color: var(--stor-muted-text); white-space: nowrap; }
    .done .name, .done .cell-amount { opacity: 0.62; }
    .cell-amount { grid-area: amount; font-size: 13.5px; font-weight: 600; text-align: right; white-space: nowrap; color: var(--stor-ink); font-variant-numeric: tabular-nums; }
    .cell-amount.income { color: var(--stor-positive); }
    .cell-end { grid-area: end; display: flex; align-items: center; justify-content: flex-end; }
    .cell-menu { grid-area: menu; display: flex; justify-content: flex-end; }
    .balance { font-family: var(--stor-font-mono); font-size: 11.5px; font-weight: 500; color: var(--stor-muted-text); white-space: nowrap; }
    .balance.low { color: var(--stor-ink); font-weight: 600; }
    .balance.below { color: var(--stor-warning); font-weight: 600; }
    .done-mark { display: inline-flex; color: var(--stor-muted-text); }
    .done-button {
        display: inline-flex;
        height: 1.75rem;
        align-items: center;
        gap: 0.25rem;
        padding: 0 0.625rem;
        border: 0;
        border-radius: 999px;
        background: var(--stor-surface);
        box-shadow: inset 0 0 0 1px var(--stor-border);
        font-size: 12px;
        font-weight: 600;
        color: var(--stor-ink);
    }
    .done-button:hover { background: var(--stor-surface-hover); }
    .done-button:disabled { opacity: 0.45; }
    @media (max-width: 639px) {
        .timeline-row {
            --check: 2.5rem;
            --date: 1.75rem;
            --gap: 0.5rem;
            grid-template-columns: var(--check) var(--date) minmax(0, 1fr) auto;
            grid-template-areas: "check date main amount" "check date main end";
            min-height: 2.875rem;
            padding-right: 0.625rem;
        }
        /* Two tight lines per row, so a phone shows about eight transactions at once. */
        .cell-main { flex-direction: column; align-items: stretch; justify-content: center; gap: 0; min-height: 0; padding: 0.375rem 0; line-height: 1.3; }
        .cell-amount { align-self: end; padding-top: 0.375rem; line-height: 1.3; }
        .cell-end { align-self: start; padding-bottom: 0.375rem; }
        .cell-menu { display: none; }
        .timeline-row.compact { grid-template-columns: var(--check) var(--date) minmax(0, 1fr) auto; grid-template-areas: "check date main amount" "check date main end"; }
        .timeline-row.compact.no-check { grid-template-columns: var(--date) minmax(0, 1fr) auto; grid-template-areas: "date main amount" "date main end"; padding-left: 1rem; }
        .timeline-row.compact.no-check.no-date { grid-template-columns: minmax(0, 1fr) auto; grid-template-areas: "main amount" "main end"; }
        .done-button { height: 1.75rem; }
    }
    /* Phones read rows at full size now that checkboxes and balances step aside. */
    @media (max-width: 767px) {
        .timeline-row { min-height: 3.25rem; }
        .name { font-size: 15px; }
        .category { font-size: 12.5px; }
        .cell-amount { font-size: 15px; }
        .cell-date b { font-size: 14px; }
    }
</style>
