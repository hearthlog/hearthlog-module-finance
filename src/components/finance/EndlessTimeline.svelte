<script lang="ts">
    import { untrack } from "svelte";
    import { EndlessList, type EndlessBlock, type EndlessPosition, type EndlessTarget, type EndlessView } from "@hearthlog/sdk/endless";
    import { monthAxis, monthKeyOf, nearestKey } from "@hearthlog/sdk/axis";
    import { MONTH_SPAN, type MonthBounds, type TimelineShow } from "../../finance/timeline.js";
    import MonthSection from "./MonthSection.svelte";
    import type { RowLike } from "./TimelineRowItem.svelte";
    import type { TimelineMonths } from "./timeline-months.svelte.js";
    import { DataPlaceholder } from "@hearthlog/sdk/ui";

    /** A month before it is measured; loading months keep roughly this height. */
    const ESTIMATE = 400;
    /** Today and scrolled-to days settle at this share of the visible height. */
    const READING_LINE = 0.35;

    let {
        store,
        today,
        anchor,
        show,
        bounds,
        domain,
        floor,
        available,
        selectedIds,
        busyId = null,
        flashId = null,
        hoveredId = null,
        hoveredDate = null,
        revision,
        onSelect,
        onEdit,
        onMarkDone,
        onRestore,
        onDelete,
        onHover,
        onVisibleChange,
    }: {
        store: TimelineMonths;
        today: string;
        /** Where the list opens: Today for today's month, otherwise the month's start. */
        anchor: string;
        show: TimelineShow;
        /** The months this filter lists; the first one is fixed while the list is open. */
        bounds: MonthBounds;
        domain: [number, number];
        floor: number;
        available: number;
        selectedIds: Set<string>;
        busyId?: string | null;
        flashId?: string | null;
        hoveredId?: string | null;
        hoveredDate?: string | null;
        /** Changes after a save or a sync; the months on screen then read again. */
        revision?: number;
        onSelect: (row: RowLike, selected: boolean) => void;
        onEdit: (row: RowLike) => void;
        onMarkDone: (row: RowLike) => void | Promise<void>;
        onRestore: (row: RowLike) => void | Promise<void>;
        onDelete: (row: RowLike) => void | Promise<void>;
        onHover?: (row: RowLike | null) => void;
        /** The first month with rows from the top edge down, and the first day showing there. */
        onVisibleChange?: (visible: { month: string; date: string }) => void;
    } = $props();

    const river = $derived(show !== "done");

    // Months are counted from today's month. All runs both ways, plans start
    // there and done history ends at its last month; an open end is wide
    // enough to feel endless without prepending anything. The first month is fixed while the
    // list is open; done history grows when a row is marked done ahead of a
    // later month.
    const base = untrack(() => monthKeyOf(today));
    const first = untrack(() => bounds.first);
    const axis = $derived(monthAxis(base, { first, last: bounds.last, span: MONTH_SPAN }));

    let list = $state<ReturnType<typeof EndlessList>>();

    const todayTarget = $derived<EndlessTarget>({
        key: monthKeyOf(today),
        at: today,
        find: (block) => block.querySelector<HTMLElement>("[data-today-line]"),
        ratio: READING_LINE,
    });

    /** A month opens at its header. */
    function monthTarget(month: string): EndlessTarget {
        return { key: month, at: `${month}-01` };
    }

    // The list opens at Today for today's month, otherwise at the month's header.
    const opening = untrack(() => {
        const month = nearestKey(axis, monthKeyOf(anchor));
        return month === monthKeyOf(today) ? todayTarget : monthTarget(month);
    });

    export function scrollToMonth(month: string, behavior: ScrollBehavior = "auto"): void {
        const key = nearestKey(axis, month);
        if (key === monthKeyOf(today) && key !== month) scrollToToday(behavior);
        else list?.scrollTo(monthTarget(key), behavior);
    }

    export function scrollToToday(behavior: ScrollBehavior = "auto"): void {
        list?.scrollTo(todayTarget, behavior);
    }

    /** Scrolls to the first row on or after a day. */
    export function scrollToDate(date: string, behavior: ScrollBehavior = "auto"): void {
        const month = monthKeyOf(date);
        if (nearestKey(axis, month) !== month) {
            scrollToMonth(month, behavior);
            return;
        }
        list?.scrollTo({
            key: month,
            at: date,
            find: (block) => [...block.querySelectorAll<HTMLElement>("[data-row-id]")].find((row) => (row.dataset.date ?? "") >= date) ?? null,
            ratio: 0.12,
        }, behavior);
    }

    /**
     * From the top edge down, the first month on screen with rows is the one
     * in view, so a run of empty months above never names what you are
     * looking at. The first row showing there names the day.
     */
    function pick(blocks: EndlessBlock[], { edge }: EndlessView): EndlessPosition {
        const shown = blocks.find(({ key }) => (store.get(key)?.rows.length ?? 0) > 0) ?? blocks[0];
        const row = [...(shown.element?.querySelectorAll<HTMLElement>("[data-row-id]") ?? [])]
            .find((element) => element.getBoundingClientRect().bottom > edge);
        return { key: shown.key, at: row?.dataset.date ?? (shown.key === monthKeyOf(today) ? today : `${shown.key}-01`) };
    }
</script>

<EndlessList
    bind:this={list}
    {axis}
    {store}
    {opening}
    estimate={ESTIMATE}
    {revision}
    anchorSelector="[data-row-id], [data-today-line]"
    home={{ ...todayTarget, label: "Today" }}
    {pick}
    onVisibleChange={(position) => onVisibleChange?.({ month: position.key, date: position.at })}
    class={river ? "[--river:2.75rem] sm:[--river:8rem] lg:[--river:9.5rem] xl:[--river:12rem]" : ""}
    data-timeline-scroll
>
    {#snippet openingPlaceholder()}
        <DataPlaceholder rows={8} label="Loading transactions" />
    {/snippet}
    {#snippet item(month, data)}
        <MonthSection
            monthKey={month}
            {data}
            {today}
            {show}
            {domain}
            {floor}
            {available}
            {selectedIds}
            {busyId}
            {flashId}
            {hoveredId}
            {hoveredDate}
            {onSelect}
            {onEdit}
            {onMarkDone}
            {onRestore}
            {onDelete}
            {onHover}
        />
    {/snippet}
</EndlessList>
