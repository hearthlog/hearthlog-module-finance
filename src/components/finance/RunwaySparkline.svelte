<script lang="ts">
    import { format, parseISO } from "date-fns";
    import type { RunwayPoint, TimelineOutlook } from "../../data/finance-timeline.js";
    import { formatAmount } from "@hearthlog/sdk/format";

    let {
        points = [],
        outlook,
        today,
        floor,
        compact = false,
        onJump,
    }: {
        points: RunwayPoint[];
        outlook: TimelineOutlook;
        today: string;
        floor: number;
        compact?: boolean;
        onJump?: (date: string) => void;
    } = $props();

    const width = $derived(compact ? 340 : 720);
    const height = $derived(compact ? 52 : 76);
    const padX = 8;
    const padY = 8;

    const series = $derived.by<RunwayPoint[]>(() => {
        if (points.length >= 2) return points;
        const base = points[0] ?? { date: today, balance: outlook.available, isToday: true };
        return [base, { date: outlook.endDate ?? today, balance: base.balance }];
    });

    const low = $derived.by(() => {
        let best = series[0];
        for (const p of series) {
            if (p.balance < best.balance) best = p;
        }
        return best;
    });

    const below = $derived(outlook.low.amount < floor);

    const geometry = $derived.by(() => {
        const vals = [...series.map((p) => p.balance), floor];
        const rawMin = Math.min(...vals);
        const rawMax = Math.max(...vals);
        const span = Math.max(rawMax - rawMin, 10000);
        const minV = rawMin - span * 0.14;
        const maxV = rawMax + span * 0.14;
        const innerW = width - padX * 2;
        const innerH = height - padY * 2;

        const xOf = (i: number) => padX + (series.length <= 1 ? 0 : (i / (series.length - 1)) * innerW);
        const yOf = (v: number) => padY + (1 - (v - minV) / (maxV - minV || 1)) * innerH;

        const coords = series.map((p, i) => ({ ...p, x: xOf(i), y: yOf(p.balance), idx: i }));
        const polyline = coords.map((c) => `${c.x.toFixed(1)},${c.y.toFixed(1)}`).join(" ");
        const first = coords[0];
        const last = coords[coords.length - 1];
        const area = `M ${first.x.toFixed(1)},${first.y.toFixed(1)} `
            + coords.slice(1).map((c) => `L ${c.x.toFixed(1)},${c.y.toFixed(1)}`).join(" ")
            + ` L ${last.x.toFixed(1)},${height} L ${first.x.toFixed(1)},${height} Z`;

        const floorY = yOf(floor);
        const lowIdx = series.indexOf(low);
        const lowCoord = coords[Math.max(0, lowIdx)];

        return { coords, polyline, area, floorY, first, last, lowCoord };
    });

    let hoveredIdx = $state<number | null>(null);
    const hovered = $derived(hoveredIdx !== null ? geometry.coords[hoveredIdx] ?? null : null);
    const gradId = $derived(compact ? "runway-grad-compact" : "runway-grad-desktop");

    function shortDate(iso: string): string {
        if (!iso || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return "";
        if (iso === today) return "Today";
        return format(parseISO(iso), "d MMM");
    }
</script>

<div class="spark-wrap" class:compact>
    {#if !compact && hovered}
        <div
            class="spark-tip"
            style:left={`${Math.min(86, Math.max(14, (hovered.x / width) * 100))}%`}
        >
            {shortDate(hovered.date)} · {formatAmount(hovered.balance)} Kč
        </div>
    {/if}

    <svg
        class="spark-svg"
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="none"
        role="img"
        aria-label={`Projected balance runway from ${shortDate(geometry.first.date)} to ${shortDate(geometry.last.date)}`}
    >
        <defs>
            <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stop-color={below ? "var(--stor-negative)" : "var(--stor-action)"} stop-opacity="0.18" />
                <stop offset="100%" stop-color={below ? "var(--stor-negative)" : "var(--stor-action)"} stop-opacity="0" />
            </linearGradient>
        </defs>

        {#if below}
            <rect
                x={padX}
                y={geometry.floorY}
                width={Math.max(0, width - padX * 2)}
                height={Math.max(0, height - geometry.floorY)}
                fill="var(--stor-negative)"
                opacity="0.07"
                rx="4"
            />
        {/if}

        <line
            x1={padX}
            y1={geometry.floorY.toFixed(1)}
            x2={width - padX}
            y2={geometry.floorY.toFixed(1)}
            stroke="var(--stor-border-strong)"
            stroke-dasharray="4 4"
            stroke-width="1"
        />

        {#if !compact && floor > 0}
            <text
                x={width - padX}
                y={Math.max(10, geometry.floorY - 4).toFixed(1)}
                text-anchor="end"
                font-size="10"
                fill="var(--stor-faint-text)"
            >
                Floor {formatAmount(floor)}
            </text>
        {/if}

        <path d={geometry.area} fill={`url(#${gradId})`} />
        <polyline
            points={geometry.polyline}
            fill="none"
            stroke={below ? "var(--stor-negative)" : "var(--stor-action)"}
            stroke-width={compact ? "2" : "2.25"}
            stroke-linecap="round"
            stroke-linejoin="round"
        />

        <circle
            cx={geometry.first.x.toFixed(1)}
            cy={geometry.first.y.toFixed(1)}
            r={compact ? "3.2" : "4"}
            fill="var(--stor-now)"
            stroke="var(--stor-surface)"
            stroke-width="2"
        />

        {#if geometry.lowCoord !== geometry.first}
            <circle
                cx={geometry.lowCoord.x.toFixed(1)}
                cy={geometry.lowCoord.y.toFixed(1)}
                r={compact ? "3.2" : "4"}
                fill={below ? "var(--stor-negative)" : "var(--stor-positive)"}
                stroke="var(--stor-surface)"
                stroke-width="2"
            />
        {/if}

        {#if !compact}
            {#each geometry.coords as pt (pt.idx)}
                <circle
                    cx={pt.x.toFixed(1)}
                    cy={pt.y.toFixed(1)}
                    r="11"
                    fill="transparent"
                    class:clickable={!!onJump && pt.date !== today}
                    role="button"
                    tabindex="-1"
                    aria-label={`${shortDate(pt.date)}: ${formatAmount(pt.balance)} Kč`}
                    onmouseenter={() => (hoveredIdx = pt.idx)}
                    onmouseleave={() => { if (hoveredIdx === pt.idx) hoveredIdx = null; }}
                    onclick={() => { if (onJump && pt.date !== today) onJump(pt.date); }}
                />
            {/each}
        {/if}
    </svg>

    {#if !compact}
        <div class="spark-legend">
            <span>● Today · {shortDate(today) === "Today" && today ? format(parseISO(today), "d MMM") : ""}</span>
            <span>Low: {shortDate(outlook.low.date)} ({formatAmount(outlook.low.amount)} Kč)</span>
            <span>{outlook.endDate ? shortDate(outlook.endDate) : "No plans ahead"}</span>
        </div>
    {/if}
</div>

<style>
    .spark-wrap {
        position: relative;
        padding-top: 8px;
    }
    .spark-wrap.compact {
        padding-top: 0;
        border-top: 0;
    }
    .spark-svg {
        display: block;
        width: 100%;
        height: 76px;
        overflow: visible;
    }
    .compact .spark-svg {
        height: 52px;
    }
    .clickable {
        cursor: pointer;
    }
    .spark-tip {
        position: absolute;
        top: 2px;
        z-index: 5;
        padding: 3px 9px;
        border-radius: 8px;
        background: var(--stor-tooltip, var(--stor-ink));
        color: var(--stor-tooltip-text, var(--stor-surface));
        font-size: 11.5px;
        font-weight: 500;
        white-space: nowrap;
        pointer-events: none;
        transform: translateX(-50%);
        box-shadow: var(--stor-elevation-2);
        font-variant-numeric: tabular-nums;
    }
    .spark-legend {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
        margin-top: 2px;
        font-size: 11px;
        color: var(--stor-faint-text);
        font-variant-numeric: tabular-nums;
    }
</style>
