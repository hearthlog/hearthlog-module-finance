<script lang="ts">
    import { format, parseISO } from "date-fns";
    import type { TimelineRow } from "../../data/finance-timeline.js";
    import type { TimelineShow } from "../../finance/timeline.js";
    import { monthKeyOf } from "@hearthlog/sdk/axis";
    import { formatAmount } from "@hearthlog/sdk/format";
    import TimelineRowItem, { type BalanceTone, type RowLike } from "./TimelineRowItem.svelte";
    import type { MonthData } from "./timeline-months.svelte.js";

    type RowEntry = { type: "row"; key: string; row: TimelineRow; divider: boolean; balance: number | null; tone: BalanceTone };
    type Entry = RowEntry | { type: "today"; key: string };

    let {
        monthKey,
        data,
        today,
        show,
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
     * Balances follow the Today line through the plans; done rows never carry
     * one. Months from today's on show balances; earlier months and done
     * history show their flows.
     */
    const tracked = $derived(show !== "done");
    const isTodayMonth = $derived(monthKey === monthKeyOf(today));
    const afterToday = $derived(monthKey > monthKeyOf(today));
    const balances = $derived(tracked && (isTodayMonth || afterToday));
    const title = $derived(format(parseISO(`${monthKey}-01`), "MMMM yyyy"));

    /** Lays out the SQL-ordered rows and carries the balance line through them. */
    const layout = $derived.by<{ entries: Entry[] }>(() => {
        if (!data) return { entries: [] };
        const result: Entry[] = [];
        let todayPlaced = false;
        let lastDate: string | null = null;
        let current = data.stats.start;
        const placeToday = () => {
            if (todayPlaced || !isTodayMonth) return;
            todayPlaced = true;
            current = available;
            result.push({ type: "today", key: "today" });
            lastDate = null;
        };
        for (const row of data.rows) {
            // Below Today: plans, and rows marked done ahead of their day.
            const projected = row.section === 1;
            if (projected) placeToday();
            const after = row.balanceAfter ?? current;
            const low = row.isLow && row.balanceAfter !== null;
            current = after;
            const entry: RowEntry = {
                type: "row",
                key: row.id,
                row,
                divider: row.firstOfDay && lastDate !== null,
                balance: row.balanceAfter,
                tone: low ? (after < floor ? "below" : "low") : "default",
            };
            lastDate = row.date;
            result.push(entry);
        }
        placeToday();
        return { entries: result };
    });
    const entries = $derived(layout.entries);

    const empty = $derived(!!data && data.rows.length === 0 && !isTodayMonth);
    const count = $derived(data?.rows.length ?? 0);
    const change = $derived(data ? data.stats.end - data.stats.start : 0);
    const net = $derived(data ? data.stats.income + data.stats.expense : 0);
    /** A month after the current one holds plans only. */
    const planned = $derived(afterToday);
</script>

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
    />
{/snippet}

<section class="month" class:empty aria-label={title}>
    <header class="month-head" data-month-head>
        <h3 class="stor-title-2 month-title">{title}</h3>
        {#if !data}
            <span class="month-stats" data-balance>Loading…</span>
        {:else if empty}
            <span class="month-stats" data-balance>No transactions{#if balances}{" · "}<b>{formatAmount(data.stats.end)}</b>{/if}</span>
        {:else}
            <span
                data-balance
                class="month-stats"
                title={balances
                    ? `Starts ${formatAmount(data.stats.start)} · In ${formatAmount(data.stats.income, { signed: true })} · Out ${formatAmount(data.stats.expense)} · Ends ${formatAmount(data.stats.end)}`
                    : `In ${formatAmount(data.stats.income, { signed: true })} · Out ${formatAmount(data.stats.expense)} · Net ${formatAmount(net, { signed: true })}`}
            >
                <b class:income={net > 0}>{formatAmount(net, { signed: true })} Kč</b>{" "}{planned ? "planned" : "net"}{" · "}{count} {count === 1 ? "transaction" : "transactions"}
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
                    <span class="today-dot" aria-hidden="true"></span>
                    <span>Today · {format(parseISO(today), "EEEE d MMMM")}</span>
                    <span class="today-rule" aria-hidden="true"></span>
                    <span class="today-available" data-balance><b>{formatAmount(available)} Kč</b></span>
                </div>
            {/if}
        {/each}
    {/if}
</section>

<style>
    .month { position: relative; padding: 0 0.5rem 0.5rem; }
    .month-head {
        position: sticky;
        top: 0;
        z-index: 2;
        display: flex;
        align-items: baseline;
        justify-content: space-between;
        gap: 0.75rem;
        margin: 0;
        padding: 1.5rem 0 0.625rem;
        border-bottom: 1px solid var(--stor-border-strong);
        background: var(--stor-surface);
    }
    .empty .month-head { position: relative; padding-top: 0.75rem; opacity: 0.7; }
    .month-title { margin: 0; color: var(--stor-ink); white-space: nowrap; }
    .month-stats { font-size: var(--stor-text-small); line-height: var(--stor-text-small-line); color: var(--stor-muted-text); white-space: nowrap; font-variant-numeric: tabular-nums; }
    .month-stats b { font-weight: 600; color: var(--stor-ink); }
    .month-stats b.income { color: var(--stor-positive); }
    .placeholder { display: flex; min-height: 21rem; flex-direction: column; gap: 0.625rem; padding: 0.75rem 0 1rem; }
    .placeholder span { height: 1.5rem; border-radius: 8px; background: var(--stor-surface-muted); }
    .today-line {
        position: relative;
        display: flex;
        align-items: center;
        gap: 0.625rem;
        height: 3rem;
        color: var(--stor-now);
        font-size: var(--stor-text-small);
        font-weight: 600;
    }
    .today-dot { flex: none; width: 8px; height: 8px; border-radius: 999px; background: var(--stor-now); box-shadow: 0 0 0 4px var(--stor-now-soft); }
    .today-rule { flex: 1; height: 1.5px; background: var(--stor-now); opacity: 0.55; }
    .today-available { flex: none; font-variant-numeric: tabular-nums; color: var(--stor-muted-text); }
    .today-available b { font-weight: 600; color: var(--stor-ink); }
    /* Phones name the month in the toolbar above the list, so headers here only divide months. */
    @media (max-width: 767px) {
        .month { padding-inline: 0; }
        .month-head { position: relative; padding: 0.875rem 0.75rem 0.5rem; }
        .month-title { font-size: var(--stor-text-title-3); line-height: var(--stor-text-title-3-line); }
    }
</style>
