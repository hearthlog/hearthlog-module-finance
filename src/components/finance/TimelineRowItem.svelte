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
    import { DropdownMenu } from "bits-ui";
    import { format, parseISO } from "date-fns";
    import { categoryLabel } from "../../finance/categories.js";
    import { categoryIcon } from "../../finance/category-icons.js";
    import { formatAmount } from "@hearthlog/sdk/format";
    import { Badge } from "@hearthlog/sdk/ui";
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
    }: {
        row: RowLike;
        today: string;
        firstOfDay?: boolean;
        /** A hairline above the first row of a day that follows another day. */
        divider?: boolean;
        /** The running balance after this row, for plans. */
        balance?: number | null;
        balanceTone?: BalanceTone;
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
    } = $props();

    let confirmDelete = $state(false);
    const day = $derived(parseISO(row.date));
    const planned = $derived(row.kind === "planned");
    /** Today's plan can leave the outlook early; tomorrow it is done anyway. */
    const markable = $derived(planned && row.date === today);
    /** Only a row done ahead of its day can go back to plans; earlier days are done by date. */
    const restorable = $derived(row.kind === "done" && row.date >= today);
    const name = $derived(row.name || "Untitled");
    const Icon = $derived(categoryIcon(row.category));
    const balanceTitle = $derived(
        balanceTone === "low" || balanceTone === "below" ? "Lowest balance ahead"
            : "Balance after this plan",
    );
</script>

<div
    class="timeline-row"
    class:divider
    class:planned
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
    <div class="cell-check" data-row-check>
        <label class="check-hit">
            <input
                type="checkbox"
                class="h-4 w-4 rounded border-[var(--stor-field-border)] accent-[var(--stor-action)]"
                checked={selected}
                aria-label={`Select ${name}`}
                onchange={(event) => onSelect?.(row, event.currentTarget.checked)}
            />
        </label>
    </div>
    <div class="cell-date" aria-hidden="true">
        {#if firstOfDay}<span class="weekday">{format(day, "EEE")}</span><b class="stor-title-2 daynum">{format(day, "d")}</b>{/if}
    </div>
    <span class="tile" aria-hidden="true"><Icon class="h-[18px] w-[18px]" /></span>
    <button type="button" class="cell-main" onclick={() => onEdit?.(row)}>
        <span class="name-line"><span class="name">{name}</span><SyncStateBadge entityId={`transaction:${row.id}`} /></span>
        <span class="category">{#if planned}<Badge class="planned-badge">Planned</Badge>{/if}{categoryLabel(row.category)}</span>
    </button>
    <div class="cell-amount">
        <span class="amount" class:income={row.amount > 0}>{formatAmount(row.amount, { signed: true })}</span>
        {#if balance !== null}<span class="balance {balanceTone}" title={balanceTitle} data-balance>{formatAmount(balance)}</span>{/if}
    </div>
    <div class="cell-end">
        {#if markable}
            <CommandOnly>
                <button type="button" class="done-button" disabled={busy} aria-label={`Mark ${name} done`} onclick={() => void onMarkDone?.(row)}>
                    <IconCheck class="h-3.5 w-3.5" />Done
                </button>
            </CommandOnly>
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
        --date: 3.25rem;
        --gap: 0.75rem;
        position: relative;
        display: grid;
        grid-template-columns: var(--check) var(--date) 2rem minmax(0, 1fr) auto 4.5rem 2.25rem;
        align-items: center;
        column-gap: var(--gap);
        min-height: 3.375rem;
        padding: 0 0.5rem;
        transition: background-color 120ms ease;
    }
    .timeline-row.divider::before {
        content: "";
        position: absolute;
        top: 0;
        right: 0.5rem;
        left: calc(var(--check) + var(--gap) + 0.5rem);
        border-top: 1px solid var(--stor-border);
    }
    .timeline-row:hover,
    .timeline-row.highlighted { background: var(--stor-surface-hover); }
    .timeline-row.selected { background: var(--stor-selected); }
    .timeline-row.flash { animation: row-flash 1.8s ease-out; }
    @keyframes row-flash {
        from { background-color: var(--stor-selected); }
        to { background-color: transparent; }
    }
    /* The checkbox keeps its column but only shows on hover, focus, a selected row or while selecting. */
    .cell-check { align-self: stretch; opacity: 0; transition: opacity 120ms ease; }
    .timeline-row:hover .cell-check, .cell-check:focus-within, .selected .cell-check, :global([data-selecting="true"]) .cell-check { opacity: 1; }
    .check-hit { display: flex; height: 100%; min-height: 2.75rem; align-items: center; justify-content: center; cursor: pointer; }
    .cell-date { display: flex; flex-direction: column; line-height: 14px; }
    .weekday { font-size: 10.5px; line-height: 14px; font-weight: 600; letter-spacing: 0.06em; text-transform: uppercase; color: var(--stor-muted-text); }
    .daynum { font-size: 20px; line-height: 22px; font-weight: 500; color: var(--stor-ink); }
    .planned .daynum { color: var(--stor-muted-text); }
    .tile { display: inline-flex; width: 2rem; height: 2rem; align-items: center; justify-content: center; border-radius: 10px; background: var(--stor-surface-muted); color: var(--stor-muted-text); }
    .planned .tile { background: transparent; box-shadow: inset 0 0 0 1px var(--stor-border-strong); }
    .cell-main {
        display: flex;
        min-width: 0;
        flex-direction: column;
        justify-content: center;
        align-self: stretch;
        padding: 0.5rem 0;
        border: 0;
        background: transparent;
        text-align: left;
        border-radius: 8px;
    }
    button.cell-main:focus-visible { outline: 2px solid var(--stor-focus); outline-offset: -2px; }
    button.cell-main:hover .name { text-decoration: underline; text-decoration-color: var(--stor-border-strong); text-underline-offset: 3px; }
    .name-line { display: inline-flex; min-width: 0; align-items: center; gap: 0.375rem; }
    .name { overflow: hidden; min-width: 0; font-size: 14px; line-height: 20px; font-weight: 500; color: var(--stor-ink); text-overflow: ellipsis; white-space: nowrap; }
    .planned .name { color: var(--stor-muted-text); }
    .category { display: flex; align-items: center; gap: 0.375rem; font-size: 12px; line-height: 16px; color: var(--stor-muted-text); white-space: nowrap; }
    .category :global(.planned-badge) { min-height: 18px; padding: 0 6px; font-size: 11px; line-height: 18px; }
    .cell-amount { display: flex; flex-direction: column; align-items: flex-end; font-variant-numeric: tabular-nums; }
    .amount { font-size: 14px; line-height: 20px; font-weight: 600; white-space: nowrap; color: var(--stor-ink); }
    .amount.income { color: var(--stor-positive); }
    .planned .amount { font-weight: 500; color: var(--stor-muted-text); }
    .balance { font-size: 12px; line-height: 16px; color: var(--stor-faint-text); white-space: nowrap; }
    .balance.low { color: var(--stor-ink); font-weight: 600; }
    .balance.below { color: var(--stor-warning); font-weight: 600; }
    .cell-end { display: flex; align-items: center; justify-content: flex-end; }
    .cell-menu { display: flex; justify-content: flex-end; }
    .done-button {
        display: inline-flex;
        height: 1.75rem;
        align-items: center;
        gap: 0.25rem;
        padding: 0 0.625rem;
        border: 0;
        border-radius: 999px;
        background: var(--stor-surface);
        box-shadow: inset 0 0 0 1px var(--stor-border-strong);
        font-size: 12px;
        font-weight: 600;
        color: var(--stor-ink);
    }
    .done-button:hover { background: var(--stor-surface-hover); }
    .done-button:disabled { opacity: 0.45; }
    @media (max-width: 639px) {
        .timeline-row {
            --check: 2.5rem;
            --date: 2.25rem;
            --gap: 0.5rem;
            grid-template-columns: var(--check) var(--date) 2rem minmax(0, 1fr) auto;
            grid-template-areas: "check date tile main amount" "check date tile main end";
            min-height: 3.25rem;
            padding-right: 0.625rem;
        }
        .cell-check { grid-area: check; }
        .cell-date { grid-area: date; }
        .tile { grid-area: tile; }
        .cell-main { grid-area: main; }
        .cell-amount { grid-area: amount; }
        .cell-end { grid-area: end; }
        .cell-menu { display: none; }
        .daynum { font-size: 17px; }
        .name { font-size: 15px; }
        .amount { font-size: 15px; }
    }
</style>
