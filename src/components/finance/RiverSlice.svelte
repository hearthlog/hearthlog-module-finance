<script module lang="ts">
    /** What the slice marks at its centre. */
    export type RiverMark = "none" | "month" | "low" | "today";
</script>

<script lang="ts">
    import { axisLabel, niceTicks } from "../../finance/timeline.js";
    import { formatAmount } from "@hearthlog/sdk/format";

    let {
        before,
        after = before,
        domain,
        floor,
        projected = false,
        income = false,
        hot = false,
        mark = "none",
        below = false,
        label = "",
        grid = false,
    }: {
        /** Balance entering the slice at its top edge. */
        before: number;
        /** Balance leaving at its bottom edge; the step happens at the centre. */
        after?: number;
        /** One fixed scale for the whole timeline. */
        domain: [number, number];
        floor: number;
        /** Plans are a dashed projection; records are solid. */
        projected?: boolean;
        income?: boolean;
        /** The row is hovered: highlight the step and show before → after. */
        hot?: boolean;
        mark?: RiverMark;
        /** The lowest point is under the floor. */
        below?: boolean;
        label?: string;
        /** Faint scale lines, used from Today on. */
        grid?: boolean;
    } = $props();

    /** Percent across the gutter, with a little air on both sides. */
    function x(value: number): number {
        const [lo, hi] = domain;
        const ratio = (value - lo) / (hi - lo || 1);
        return Math.max(0.5, Math.min(99.5, 4 + ratio * 92));
    }

    const xb = $derived(x(before));
    const xa = $derived(x(after));
    const steps = $derived(Math.abs(xa - xb) > 0.05);
    const floorX = $derived(floor > domain[0] && floor < domain[1] ? x(floor) : null);
    const ticks = $derived(grid || mark === "today" ? niceTicks(domain[0], domain[1], 3).map((value) => ({ value, x: x(value) })) : []);
    const markX = $derived(mark === "today" || mark === "month" ? xb : xa);
    const labelRight = $derived(markX < 58);
</script>

<div class="slice" class:hot aria-hidden="true">
    <svg viewBox="0 0 100 100" preserveAspectRatio="none">
        {#if grid}
            {#each ticks as tick (tick.value)}<line class="grid" x1={tick.x} x2={tick.x} y1="0" y2="100" vector-effect="non-scaling-stroke" />{/each}
        {/if}
        {#if floorX !== null && (grid || projected)}
            <line class="floor" x1={floorX} x2={floorX} y1="0" y2="100" vector-effect="non-scaling-stroke" />
        {/if}
        <polygon class="area" points={`0,0 ${xb},0 ${xb},50 ${xa},50 ${xa},100 0,100`} />
        <path class="line" class:projected d={`M${xb},0 V50 H${xa} V100`} vector-effect="non-scaling-stroke" />
        {#if steps}
            <line class="jog" class:income x1={xb} x2={xa} y1="50" y2="50" vector-effect="non-scaling-stroke" />
        {/if}
        {#if mark === "today"}
            <line class="today" x1="0" x2="100" y1="50" y2="50" vector-effect="non-scaling-stroke" />
        {/if}
    </svg>
    {#if mark === "today"}
        {#each ticks as tick (tick.value)}<span class="tick" style:left={`${tick.x}%`}>{axisLabel(tick.value)}</span>{/each}
    {/if}
    {#if mark !== "none"}
        <span class="dot {mark}" class:below style:left={`${markX}%`}></span>
    {/if}
    {#if label}
        <span class="label" class:low={mark === "low"} class:below class:right={labelRight} style:left={`${markX}%`}>{label}</span>
    {/if}
    {#if hot && steps}
        <span class="hover" style:left={`${Math.min(70, Math.max(30, (xb + xa) / 2))}%`}>{formatAmount(before)} → {formatAmount(after)}</span>
    {/if}
</div>

<style>
    .slice { position: absolute; inset: 0; container-type: inline-size; pointer-events: none; }
    svg { position: absolute; inset: 0; width: 100%; height: 100%; overflow: visible; }
    .grid { stroke: color-mix(in srgb, var(--stor-border) 62%, transparent); stroke-width: 1; }
    .floor { stroke: var(--stor-warning); stroke-width: 1; stroke-dasharray: 4 3; }
    .area { fill: color-mix(in srgb, var(--stor-ink) 6%, transparent); }
    .line { fill: none; stroke: var(--stor-ink); stroke-width: 1.25; }
    .line.projected { stroke-dasharray: 4 3; }
    .jog { stroke: var(--stor-ink); stroke-width: 2.5; stroke-linecap: round; }
    .jog.income { stroke: var(--stor-positive); }
    .hot .jog { stroke: var(--stor-action); stroke-width: 4; }
    .today { stroke: var(--stor-action); stroke-width: 1.5; opacity: 0.85; }
    .dot { position: absolute; top: 50%; width: 7px; height: 7px; border-radius: 50%; transform: translate(-50%, -50%); background: var(--stor-ink); }
    .dot.low { width: 9px; height: 9px; border: 2px solid var(--stor-ink); background: var(--stor-surface); }
    .dot.low.below { border-color: var(--stor-warning); }
    .dot.today { width: 9px; height: 9px; border: 2px solid var(--stor-action); background: var(--stor-surface); }
    .label, .tick, .hover { position: absolute; font-family: var(--stor-font-mono); font-size: 10px; font-weight: 600; line-height: 1; white-space: nowrap; }
    .label { top: 50%; color: var(--stor-ink); transform: translate(calc(-100% - 7px), -50%); }
    .label.right { transform: translate(7px, -50%); }
    .label.low { top: calc(50% + 12px); }
    .label.below { color: var(--stor-warning); }
    .tick { top: calc(50% - 16px); color: var(--stor-muted-text); font-size: 9.5px; font-weight: 500; transform: translateX(-50%); }
    .hover {
        top: calc(50% - 22px);
        z-index: 1;
        padding: 3px 6px;
        border-radius: 5px;
        background: var(--stor-surface-raised);
        box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--stor-border) 80%, transparent);
        color: var(--stor-ink);
        transform: translateX(-50%);
    }
    @container (max-width: 90px) {
        .label, .tick, .hover { display: none; }
    }
</style>
