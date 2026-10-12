<script lang="ts">
    import { differenceInCalendarDays, format, parseISO } from "date-fns";
    import type { Asset } from "../../data/assets.js";
    import type { TimelineOutlook } from "../../data/finance-timeline.js";
    import { parseFloor } from "../../finance/floor.js";
    import { formatAmount } from "@hearthlog/sdk/format";
    import { Amount } from "@hearthlog/sdk/ui";
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

<!-- Phones show the two numbers that decide the month; opening Available now adds the rest and the assets. -->
<section class="stor-panel readout shrink-0" class:open={assetsOpen || sheet} class:sheet aria-label="Outlook">
    <div class="cell">
        <button type="button" class="cell-button" aria-expanded={assetsOpen} aria-controls="finance-current-assets" onclick={() => (assetsOpen = !assetsOpen)}>
            <span class="label">Available now<IconChevronDown class="phone-only h-3.5 w-3.5 shrink-0 transition-transform {assetsOpen ? 'rotate-180' : ''}" /></span>
            <span class="value"><DataValue><Amount value={outlook.available} /></DataValue></span>
            <span class="sub">
                <span class="truncate">{assetNames || "Add current assets"}</span>
                <IconChevronDown class="h-3.5 w-3.5 shrink-0 transition-transform {assetsOpen ? 'rotate-180' : ''}" />
            </span>
        </button>
    </div>
    <div class="cell" class:warn={below}>
        <button type="button" class="cell-button" disabled={!onJump || lowDay === "Today"} onclick={() => onJump?.(outlook.low.date)}>
            <span class="label">Lowest ahead</span>
            <span class="value">
                <DataValue><Amount value={outlook.low.amount} /></DataValue>
            </span>
            <span class="sub">
                <DataValue>{lowDay}{lowDistance > 0 && floor === 0 && !below ? ` · in ${lowDistance} ${lowDistance === 1 ? "day" : "days"}` : ` · ${formatAmount(below ? -margin : margin)} ${below ? "under" : "over"} floor`}</DataValue>
            </span>
        </button>
    </div>
    <div class="cell extra">
        <button type="button" class="cell-button" disabled={!onJump || !outlook.endDate} onclick={() => outlook.endDate && onJump?.(outlook.endDate)}>
            <span class="label">After last plan</span>
            <span class="value">
                <DataValue><Amount value={outlook.end} /></DataValue>
            </span>
            <span class="sub"><DataValue>{outlook.endDate ? `${endDay} · ${formatAmount(outlook.end - outlook.available, { signed: true })}` : "Nothing planned"}</DataValue></span>
        </button>
    </div>
    <div class="cell extra">
        <label class="label" for="finance-floor">Floor</label>
        <span class="value">
            <input
                id="finance-floor"
                class="floor-input"
                inputmode="numeric"
                autocomplete="off"
                value={formatAmount(floor)}
                aria-describedby="finance-floor-help"
                onchange={(event) => commitFloor(event.currentTarget)}
                onkeydown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); }}
            /><span class="stor-unit">Kč</span>
        </span>
        <span class="sub" id="finance-floor-help">Warn below this balance</span>
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
        grid-template-columns: repeat(4, minmax(0, 1fr));
        overflow: hidden;
    }
    .cell {
        position: relative;
        display: flex;
        min-width: 0;
        flex-direction: column;
        gap: 2px;
        padding: 0.875rem 1.25rem 0.8125rem;
        border-left: 1px solid color-mix(in srgb, var(--stor-border) 62%, transparent);
    }
    .cell:has(> .cell-button) { padding: 0; }
    .cell:first-child { border-left: 0; }
    .cell-button {
        display: flex;
        min-width: 0;
        flex-direction: column;
        gap: 2px;
        padding: 0.875rem 1.25rem 0.8125rem;
        border: 0;
        background: transparent;
        text-align: left;
        color: inherit;
    }
    .cell:first-child .cell-button { border-radius: var(--stor-panel-radius) 0 0 var(--stor-panel-radius); }
    .cell-button:not(:disabled):hover { background: var(--stor-surface-hover); }
    .cell-button:disabled { cursor: default; }
    .cell-button:focus-visible { outline: 2px solid var(--stor-focus); outline-offset: -2px; }
    .label { font-size: 12px; font-weight: 500; color: var(--stor-muted-text); }
    .value {
        display: flex;
        flex-wrap: wrap;
        align-items: baseline;
        column-gap: 0.5rem;
        font-size: 22px;
        font-weight: 600;
        line-height: 1.25;
        letter-spacing: -0.012em;
        color: var(--stor-ink);
        white-space: nowrap;
        font-variant-numeric: tabular-nums;
    }
    .warn .value, .warn .sub { color: var(--stor-warning); }
    .sub {
        display: flex;
        min-width: 0;
        align-items: center;
        gap: 0.25rem;
        overflow: hidden;
        font-family: var(--stor-font-mono);
        font-size: 11.5px;
        font-weight: 500;
        color: var(--stor-muted-text);
        white-space: nowrap;
        text-overflow: ellipsis;
    }
    .floor-input {
        width: 7ch;
        padding: 0;
        border: 0;
        border-bottom: 1.5px dashed var(--stor-border);
        border-radius: 0;
        background: transparent;
        font: inherit;
        letter-spacing: inherit;
        color: inherit;
        outline: none;
    }
    .floor-input:focus { border-bottom-color: var(--stor-focus); }
    @media (max-width: 1023px) {
        .cell { padding: 0.625rem 0.875rem; }
        .cell-button { padding: 0.625rem 0.875rem; }
        .value { font-size: 18px; }
    }
    .label { display: flex; align-items: center; gap: 0.25rem; }
    .label :global(.phone-only) { display: none; }
    .sheet { grid-template-columns: repeat(2, minmax(0, 1fr)); box-shadow: none; border: 1px solid color-mix(in srgb, var(--stor-border) 62%, transparent); }
    .sheet .cell:nth-child(3) { border-left: 0; }
    .sheet .extra { display: flex; border-top: 1px solid color-mix(in srgb, var(--stor-border) 62%, transparent); }
    .sheet .label :global(.phone-only) { display: none; }
    /* Phones keep the outlook to one short row: label and figure, the details once it is opened. */
    @media (max-width: 639px) {
        .readout { grid-template-columns: repeat(2, minmax(0, 1fr)); }
        .cell, .cell-button { gap: 0; padding: 0.4375rem 0.75rem 0.5rem; }
        .label { font-size: 11px; line-height: 1.3; }
        .label :global(.phone-only) { display: block; }
        .value { font-size: 16px; line-height: 1.3; }
        .sub { font-size: 11px; }
        .readout:not(.open) .sub { display: none; }
        .extra { display: none; }
        .open .extra { display: flex; border-top: 1px solid color-mix(in srgb, var(--stor-border) 62%, transparent); }
        .open .cell:nth-child(3) { border-left: 0; }
        .open .cell:first-child .cell-button { border-radius: var(--stor-panel-radius) 0 0 0; }
    }
</style>
