<script lang="ts">
    import { format, parseISO } from "date-fns";
    import type { TimelineRow } from "../../data/finance-timeline.js";
    import { axisLabel, type TimelineShow } from "../../finance/timeline.js";
    import { monthKeyOf } from "@hearthlog/sdk/axis";
    import { formatAmount } from "@hearthlog/sdk/format";
    import TimelineRowItem, { type BalanceTone, type RowLike } from "./TimelineRowItem.svelte";
    import RiverSlice, { type RiverMark } from "./RiverSlice.svelte";
    import type { MonthData } from "./timeline-months.svelte.js";

    type Slice = { before: number; after: number; projected: boolean; mark: RiverMark; label: string; grid: boolean; below: boolean };
    type RowEntry = { type: "row"; key: string; row: TimelineRow; divider: boolean; balance: number | null; tone: BalanceTone; slice: Slice };
    type Entry = RowEntry | { type: "today"; key: string; slice: Slice };

    let {
        monthKey,
        data,
        today,
        show,
        domain,
        floor,
        available,
        selectedIds,
        busyId = null,
        flashId = null,
        hoveredId = null,
        hoveredDate = null,
        onSelect,
        onEdit,
        onMarkDone,
        onRestore,
        onDelete,
        onHover,
    }: {
        monthKey: string;
        data: MonthData | undefined;
        today: string;
        show: TimelineShow;
        domain: [number, number];
        floor: number;
        available: number;
        selectedIds: Set<string>;
        busyId?: string | null;
        flashId?: string | null;
        hoveredId?: string | null;
        hoveredDate?: string | null;
        onSelect: (row: RowLike, selected: boolean) => void;
        onEdit: (row: RowLike) => void;
        onMarkDone: (row: RowLike) => void | Promise<void>;
        onRestore: (row: RowLike) => void | Promise<void>;
        onDelete: (row: RowLike) => void | Promise<void>;
        onHover?: (row: RowLike | null) => void;
    } = $props();

    /**
     * The balance line runs from the Today line through the plans; done rows
     * never draw it. Months from today's on show balances; earlier months and
     * done history show their flows.
     */
    const river = $derived(show !== "done");
    const isTodayMonth = $derived(monthKey === monthKeyOf(today));
    const afterToday = $derived(monthKey > monthKeyOf(today));
    const balances = $derived(river && (isTodayMonth || afterToday));
    const title = $derived(format(parseISO(`${monthKey}-01`), "MMMM yyyy"));

    /** Lays out the SQL-ordered rows and carries the balance line through them. */
    const layout = $derived.by<{ entries: Entry[]; last: number }>(() => {
        if (!data) return { entries: [], last: 0 };
        const result: Entry[] = [];
        let todayPlaced = false;
        let lastDate: string | null = null;
        let current = data.stats.start;
        const placeToday = () => {
            if (todayPlaced || !isTodayMonth) return;
            todayPlaced = true;
            current = available;
            result.push({ type: "today", key: "today", slice: { before: available, after: available, projected: false, mark: "today", label: "", grid: false, below: false } });
            lastDate = null;
        };
        for (const row of data.rows) {
            // Below Today: plans, and rows marked done ahead of their day.
            const projected = row.section === 1;
            if (projected) placeToday();
            const after = row.balanceAfter ?? current;
            const low = row.isLow && row.balanceAfter !== null;
            const slice: Slice = {
                before: current,
                after,
                projected,
                mark: low ? "low" : "none",
                label: low ? `Low ahead ${axisLabel(after)}` : "",
                grid: projected,
                below: low && after < floor,
            };
            current = after;
            const entry: RowEntry = {
                type: "row",
                key: row.id,
                row,
                divider: row.firstOfDay && lastDate !== null,
                balance: row.balanceAfter,
                tone: low ? (after < floor ? "below" : "low") : "default",
                slice,
            };
            lastDate = row.date;
            result.push(entry);
        }
        placeToday();
        return { entries: result, last: current };
    });
    const entries = $derived(layout.entries);

    const empty = $derived(!!data && data.rows.length === 0 && !isTodayMonth);
    const change = $derived(data ? data.stats.end - data.stats.start : 0);
    const net = $derived(data ? data.stats.income + data.stats.expense : 0);
</script>

{#snippet slice(value: Slice, hot = false, income = false)}
    <RiverSlice before={value.before} after={value.after} {domain} {floor} projected={value.projected} {income} {hot} mark={value.mark} label={value.label} grid={value.grid} below={value.below} />
{/snippet}

{#snippet rowView(entry: RowEntry)}
    <TimelineRowItem
        row={entry.row}
        {today}
        firstOfDay={entry.row.firstOfDay}
        divider={entry.divider}
        balance={entry.balance}
        balanceTone={entry.tone}
        selected={selectedIds.has(entry.row.id)}
        busy={busyId === entry.row.id}
        highlighted={hoveredDate === entry.row.date || hoveredId === entry.row.id}
        flash={flashId === entry.row.id}
        {onSelect}
        {onEdit}
        {onMarkDone}
        {onRestore}
        {onDelete}
        {onHover}
    >
        {#snippet gutter()}{#if river && entry.slice.projected}{@render slice(entry.slice, hoveredId === entry.row.id, entry.row.amount > 0)}{/if}{/snippet}
    </TimelineRowItem>
{/snippet}

<section class="month" class:empty aria-label={title}>
    {#if river && afterToday && data}
        <!-- The header sticks while its month scrolls; its piece of the line stays in place. -->
        <div class="gutter head-gutter" data-river>
            {@render slice({ before: data.stats.start, after: data.stats.start, projected: true, mark: empty ? "none" : "month", label: empty ? "" : formatAmount(data.stats.start), grid: true, below: false })}
        </div>
    {/if}
    <header class="month-head" data-month-head>
        <h3 class="stor-serif-title month-title">{title}</h3>
        {#if !data}
            <span class="month-stats" data-balance>Loading…</span>
        {:else if empty}
            <span class="month-stats" data-balance>No transactions{#if balances}{" · "}<b>{formatAmount(data.stats.end)}</b>{/if}</span>
        {:else if !balances}
            <span
                data-balance
                class="month-stats"
                title={`In ${formatAmount(data.stats.income, { signed: true })} · Out ${formatAmount(data.stats.expense)} · Net ${formatAmount(net, { signed: true })}`}
            >
                <span class="hidden sm:inline">{formatAmount(data.stats.income, { signed: true })}{" · "}{formatAmount(data.stats.expense)}{" · "}</span><b class:income={net > 0}>{formatAmount(net, { signed: true })}</b>
            </span>
        {:else}
            <span
                data-balance
                class="month-stats"
                title={`Starts ${formatAmount(data.stats.start)} · In ${formatAmount(data.stats.income, { signed: true })} · Out ${formatAmount(data.stats.expense)} · Ends ${formatAmount(data.stats.end)}`}
            >
                <span class="hidden sm:inline">{formatAmount(data.stats.start)}{" → "}</span><b>{formatAmount(data.stats.end)}</b>{" "}<b class:income={change > 0}>({formatAmount(change, { signed: true })})</b>
            </span>
        {/if}
    </header>

    {#if !data}
        <div class="placeholder" role="status" aria-label={`Loading ${title}`}>
            {#each [0, 1, 2] as line (line)}<span class="motion-safe:animate-pulse"></span>{/each}
        </div>
    {:else}
        {#each entries as entry (entry.key)}
            {#if entry.type === "row"}
                {@render rowView(entry)}
            {:else}
                <div class="today-line" data-today-line>
                    {#if river}<div class="gutter" data-river>{@render slice(entry.slice)}</div>{/if}
                    <span class="today-pill">Today · {format(parseISO(today), "EEE d MMM")}</span>
                    <span class="today-rule" aria-hidden="true"></span>
                    <span class="today-available" data-balance><b>{formatAmount(available)}</b><span class="hidden sm:inline">{" "}available</span></span>
                </div>
            {/if}
        {/each}
        {#if !empty}
            <div class="tail" aria-hidden="true">
                {#if balances}<div class="gutter" data-river>{@render slice({ before: layout.last, after: data.stats.end, projected: true, mark: "none", label: "", grid: true, below: false })}</div>{/if}
            </div>
        {/if}
    {/if}
</section>

<style>
    .month { position: relative; }
    .tail { position: relative; height: 0.75rem; }
    .gutter { position: absolute; top: 0; bottom: 0; left: 0; width: var(--river, 0px); }
    .month-head {
        --head: 3rem;
        position: sticky;
        top: 0;
        z-index: 2;
        display: flex;
        height: var(--head);
        align-items: baseline;
        gap: 0.75rem;
        margin: 0;
        padding: 1.125rem 0.75rem 0 calc(var(--river, 0px) + 0.75rem);
        background: linear-gradient(to right, transparent var(--river, 0px), var(--stor-surface) var(--river, 0px));
    }
    .head-gutter { bottom: auto; height: 3rem; }
    .empty .head-gutter { height: 2.25rem; }
    .month-head::after {
        content: "";
        position: absolute;
        right: 0.5rem;
        bottom: 0;
        left: calc(var(--river, 0px) + 0.75rem);
        border-bottom: 1px solid color-mix(in srgb, var(--stor-border) 62%, transparent);
    }
    .empty .month-head { --head: 2.25rem; position: relative; padding-top: 0.625rem; background: transparent; }
    .empty .month-head::after { display: none; }
    .empty .month-title { font-size: 14px; color: var(--stor-muted-text); }
    .month-title { margin: 0; font-size: 17px; line-height: 1.3; color: var(--stor-ink); white-space: nowrap; }
    .month-stats { margin-left: auto; font-family: var(--stor-font-mono); font-size: 11.5px; font-weight: 500; color: var(--stor-muted-text); white-space: nowrap; }
    .month-stats b { font-weight: 600; color: var(--stor-ink); }
    .month-stats b.income { color: var(--stor-positive); }
    .placeholder { display: flex; min-height: 21rem; flex-direction: column; gap: 0.625rem; padding: 0.75rem 0.75rem 1rem calc(var(--river, 0px) + 0.75rem); }
    .placeholder span { height: 1.5rem; border-radius: 8px; background: var(--stor-surface-muted); }
    .today-line {
        position: relative;
        display: flex;
        align-items: center;
        gap: 0.625rem;
        height: 2.75rem;
        padding: 0 0.75rem 0 calc(var(--river, 0px) + 0.75rem);
    }
    .today-pill { flex: none; padding: 3px 9px; border-radius: 999px; background: var(--stor-action); color: var(--stor-action-text); font-size: 11.5px; font-weight: 600; }
    .today-rule { flex: 1; height: 1.5px; background: var(--stor-action); opacity: 0.85; }
    .today-available { flex: none; font-family: var(--stor-font-mono); font-size: 11.5px; font-weight: 500; color: var(--stor-muted-text); }
    .today-available b { font-weight: 600; color: var(--stor-ink); }
    /* Phones name the month in the toolbar above the list, so headers here only divide months. */
    @media (max-width: 767px) {
        .month-head { --head: 2.25rem; position: relative; padding-top: 0.875rem; }
        .month-title { font-family: var(--stor-font-sans); font-size: 11px; font-weight: 600; letter-spacing: 0.08em; text-transform: uppercase; color: var(--stor-muted-text); }
    }
</style>
