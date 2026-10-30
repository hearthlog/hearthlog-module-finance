<script lang="ts">
    import { differenceInCalendarDays, format, parseISO } from "date-fns";
    import type { Asset } from "../../data/assets.js";
    import type { TimelineOutlook } from "../../data/finance-timeline.js";
    import { parseFloor } from "../../finance/floor.js";
    import { formatAmount } from "@hearthlog/sdk/format";
    import { Metric } from "@hearthlog/sdk/ui";
    import { DataValue } from "@hearthlog/sdk/ui";
    import AssetView from "./AssetView.svelte";
    import IconChevronDown from "~icons/mdi/chevron-down";

    let {
        outlook,
        today,
        floor,
        assets,
        assetsSum,
        onFloorChange,
        onJump,
        sheet = false,
        onUpdateAssets,
    }: {
        outlook: TimelineOutlook;
        today: string;
        floor: number;
        assets: Asset[];
        assetsSum: number;
        onFloorChange: (value: number) => void;
        /** Scrolls the list to a day named in the readout. */
        onJump?: (date: string) => void;
        /** In the phone summary sheet: every figure and the assets, two by two. */
        sheet?: boolean;
        /** In the sheet: opens every balance for editing in place of the outlook. */
        onUpdateAssets?: () => void;
    } = $props();

    // svelte-ignore state_referenced_locally
    let assetsOpen = $state(sheet);
    const margin = $derived(outlook.low.amount - floor);
    const below = $derived(margin < 0);
    const lowDay = $derived(
        !outlook.low.date ? "" : outlook.low.date === today ? "Today" : format(parseISO(outlook.low.date), "EEE d MMM"),
    );
    const lowDistance = $derived(outlook.low.date && today ? differenceInCalendarDays(parseISO(outlook.low.date), parseISO(today)) : 0);
    const endDay = $derived(outlook.endDate ? format(parseISO(outlook.endDate), outlook.endDate.slice(0, 4) === today.slice(0, 4) ? "d MMM" : "d MMM yyyy") : "");
    const assetNames = $derived(assets.map((asset) => asset.name).join(" · "));

    function commitFloor(input: HTMLInputElement): void {
        const value = parseFloor(input.value);
        if (value === null) {
            input.value = formatAmount(floor);
            return;
        }
        input.value = formatAmount(value);
        if (value !== floor) onFloorChange(value);
    }
</script>

<!-- One summary band: Available now leads as the display figure, the rest sit beside it behind hairlines.
     Phones show the two numbers that decide the month; opening Available now adds the rest and the assets. -->
<section class="readout shrink-0" class:open={assetsOpen || sheet} class:sheet aria-label="Outlook">
    <div class="cell lead">
        <button type="button" class="cell-button" aria-expanded={assetsOpen} aria-controls="finance-current-assets" aria-label="Available now" onclick={() => (assetsOpen = !assetsOpen)}>
            <Metric label="Available now" size="lg" unit="Kč" detail={assetNames || "Add current assets"}>
                <DataValue>{formatAmount(outlook.available)}</DataValue>
            </Metric>
            <IconChevronDown class="chevron h-4 w-4 shrink-0 transition-transform {assetsOpen ? 'rotate-180' : ''}" />
        </button>
    </div>
    <div class="cell" class:warn={below}>
        <button type="button" class="cell-button" disabled={!onJump || lowDay === "Today"} onclick={() => onJump?.(outlook.low.date)}>
            <Metric label="Lowest ahead" unit="Kč" tone={below ? "negative" : "neutral"}>
                <DataValue>{formatAmount(outlook.low.amount)}</DataValue>
                {#snippet delta()}<DataValue>{lowDay}{lowDistance > 0 && floor === 0 && !below ? ` · in ${lowDistance} ${lowDistance === 1 ? "day" : "days"}` : ` · ${formatAmount(below ? -margin : margin)} ${below ? "under" : "over"} floor`}</DataValue>{/snippet}
            </Metric>
        </button>
    </div>
    <div class="cell extra">
        <button type="button" class="cell-button" disabled={!onJump || !outlook.endDate} onclick={() => outlook.endDate && onJump?.(outlook.endDate)}>
            <Metric label="After last plan" unit="Kč">
                <DataValue>{formatAmount(outlook.end)}</DataValue>
                {#snippet delta()}<DataValue>{outlook.endDate ? `${endDay} · ${formatAmount(outlook.end - outlook.available, { signed: true })}` : "Nothing planned"}</DataValue>{/snippet}
            </Metric>
        </button>
    </div>
    <div class="cell extra">
        <label class="floor-label" for="finance-floor">Edit floor</label>
        <Metric label="Floor" unit="Kč" detail="Warn below this balance">
            <input
                id="finance-floor"
                class="floor-input"
                inputmode="numeric"
                autocomplete="off"
                value={formatAmount(floor)}
                onchange={(event) => commitFloor(event.currentTarget)}
                onkeydown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); }}
            />
        </Metric>
    </div>
</section>

{#if sheet && onUpdateAssets}
    <!-- The sheet lists the assets; Update assets opens every balance in one place. -->
    <div id="finance-current-assets" class="mt-3 flex flex-col">
        <p class="text-xs font-semibold uppercase tracking-wide text-[var(--stor-muted-text)]">Assets</p>
        {#each assets as asset (asset.id)}
            <div class="flex min-h-12 items-center justify-between gap-3 border-b border-[color-mix(in_srgb,var(--stor-border)_62%,transparent)] text-[15px]">
                <span class="min-w-0 truncate text-[var(--stor-ink)]">{asset.name}</span>
                <b class="shrink-0 font-semibold tabular-nums text-[var(--stor-ink)]">{formatAmount(Number(asset.amount))} Kč</b>
            </div>
        {:else}
            <p class="py-3 text-sm text-[var(--stor-muted-text)]">No assets yet.</p>
        {/each}
        <button type="button" class="flex min-h-12 items-center justify-between text-left text-[15px] font-semibold text-[var(--stor-accent-text)]" onclick={onUpdateAssets}>
            {assets.length ? "Update assets" : "Add an asset"}<IconChevronDown class="h-5 w-5 -rotate-90" />
        </button>
    </div>
{:else if assetsOpen}
    <div id="finance-current-assets" class="shrink-0">
        <AssetView {assets} {assetsSum} onUpdateAll={onUpdateAssets} />
    </div>
{/if}

<style>
    .readout {
        display: grid;
        grid-template-columns: 1.55fr repeat(3, minmax(0, 1fr));
        border-block: 1px solid var(--stor-border);
    }
    .cell { position: relative; min-width: 0; padding: 1rem 1.5rem; border-left: 1px solid var(--stor-border); }
    .cell:first-child { border-left: 0; padding-left: 0; }
    /* From 640px the outlook is one card: hairline frame, card shadow, cells split by the rule colour. */
    @media (min-width: 640px) {
        .readout:not(.sheet) { border: 1px solid var(--stor-hairline); border-radius: var(--stor-section-radius); background: var(--stor-surface); box-shadow: var(--stor-elevation-1); overflow: hidden; }
        .readout:not(.sheet) .cell { border-left-color: var(--stor-rule); }
        .readout:not(.sheet) .cell:first-child { padding-left: 1.5rem; }
        .readout:not(.sheet) .lead .cell-button { padding-left: 1.5rem; }
    }
    .cell:has(> .cell-button) { padding: 0; }
    .cell-button {
        position: relative;
        display: block;
        width: 100%;
        height: 100%;
        padding: 1rem 1.5rem;
        border: 0;
        background: transparent;
        text-align: left;
        color: inherit;
    }
    .lead .cell-button { padding-left: 0; }
    .cell-button:not(:disabled):hover { background: var(--stor-surface-hover); }
    .cell-button:disabled { cursor: default; }
    .cell-button:focus-visible { outline: 2px solid var(--stor-focus); outline-offset: -2px; }
    .readout :global(.chevron) { position: absolute; top: 1rem; right: 1rem; color: var(--stor-faint-text); }
    .warn :global(.stor-metric-support) { color: var(--stor-warning); }
    .floor-label { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); }
    .floor-input {
        width: 7ch;
        padding: 0;
        border: 0;
        border-bottom: 1.5px dashed var(--stor-border-strong);
        border-radius: 0;
        background: transparent;
        font: inherit;
        letter-spacing: inherit;
        color: inherit;
        outline: none;
    }
    .floor-input:focus { border-bottom-color: var(--stor-focus); }
    @media (max-width: 1023px) {
        .readout { grid-template-columns: repeat(4, minmax(0, 1fr)); }
        .cell, .cell-button { padding: 0.75rem 1rem; }
    }
    .sheet { grid-template-columns: repeat(2, minmax(0, 1fr)); border-block: 0; }
    .sheet .cell:first-child { padding-left: 1rem; }
    .sheet .lead .cell-button { padding-left: 1rem; }
    .sheet .cell:nth-child(3) { border-left: 0; }
    .sheet .extra { border-top: 1px solid var(--stor-border); }
    /* Phones keep the outlook to one short row: label and figure, the details once it is opened. */
    @media (max-width: 639px) {
        .readout { grid-template-columns: repeat(2, minmax(0, 1fr)); }
        .cell, .cell-button { padding: 0.5rem 0.75rem; }
        .readout:not(.open) :global(.stor-metric-support) { display: none; }
        .extra { display: none; }
        .open .extra { display: block; border-top: 1px solid var(--stor-border); }
        .open .cell:nth-child(3) { border-left: 0; }
    }
</style>
