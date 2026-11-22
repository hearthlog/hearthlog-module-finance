<script lang="ts">
    import { differenceInCalendarDays, format, parseISO } from "date-fns";
    import type { Asset, BankConnection, BankMail } from "../../data/assets.js";
    import { orderAccounts, overviewOf, summarizeAccount, withUnreadMail, type AccountSummary } from "../../finance/accounts.js";
    import { removeAsset, saveHandKeptAsset } from "../../finance/account-commands.js";
    import { appClock, notify } from "@hearthlog/sdk/runtime";
    import AccountsStrip from "./AccountsStrip.svelte";
    import AccountDrawer from "./AccountDrawer.svelte";
    import AssetDrawer from "./AssetDrawer.svelte";
    import LinkBankDrawer from "./LinkBankDrawer.svelte";
    import BankMark from "./BankMark.svelte";
    import type { RunwayPoint, TimelineOutlook } from "../../data/finance-timeline.js";
    import { parseFloor } from "../../finance/floor.js";
    import { formatAmount } from "@hearthlog/sdk/format";
    import { Metric } from "@hearthlog/sdk/ui";
    import { DataValue } from "@hearthlog/sdk/ui";
    import AssetView from "./AssetView.svelte";
    import RunwaySparkline from "./RunwaySparkline.svelte";
    import IconChevronDown from "~icons/mdi/chevron-down";

    let {
        outlook,
        runway = [],
        today,
        floor,
        assets,
        assetsSum,
        connections = [],
        mails = [],
        onFloorChange,
        onJump,
        sheet = false,
        railVisible = false,
        onUpdateAssets,
    }: {
        outlook: TimelineOutlook;
        runway?: RunwayPoint[];
        today: string;
        floor: number;
        assets: Asset[];
        assetsSum: number;
        /** Links to banks: with one, the assets show as accounts with their state. */
        connections?: BankConnection[];
        /** Mails set aside: unread ones show on their bank's account, a forwarding code in the linking step. */
        mails?: BankMail[];
        onFloorChange: (value: number) => void;
        /** Scrolls the list to a day named in the readout. */
        onJump?: (date: string) => void;
        /** In the phone summary sheet: every figure and the assets, two by two. */
        sheet?: boolean;
        /** When the desktop rail shows accounts persistently, Available now stays a clean readout. */
        railVisible?: boolean;
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

    // Linked accounts: each asset's state from its own fields and its connection's. The clock is read with the
    // data, so stamps move whenever the page refreshes.
    const now = $derived.by(() => { void assets; void connections; return appClock.now(); });
    const accountAssets = $derived(withUnreadMail(assets, mails));
    const accounts = $derived.by<AccountSummary[]>(() => orderAccounts(accountAssets.map((asset) =>
        summarizeAccount(asset, connections.find((connection) => connection.id === asset.connection_id) ?? null, now))));
    const overview = $derived(overviewOf(accounts, accountAssets, now));
    let linking = $state(false);
    const linked = $derived(overview.linked > 0);

    let openAccountId = $state<string | null>(null);
    let editingAssetId = $state<string | null>(null);
    let addingAsset = $state(false);
    const openAccount = $derived(accounts.find((account) => account.id === openAccountId) ?? null);
    const openAsset = $derived(accountAssets.find((asset) => asset.id === openAccountId) ?? null);
    const editingAsset = $derived(assets.find((asset) => asset.id === editingAssetId) ?? null);

    function openFromStrip(account: AccountSummary): void {
        if (account.linked) openAccountId = account.id;
        else editingAssetId = account.id;
    }

    async function saveAsset(draft: { name: string; amount: number }): Promise<void> {
        await saveHandKeptAsset(editingAsset, draft);
        notify.success(editingAsset ? "Asset updated" : "Asset added");
        editingAssetId = null;
        addingAsset = false;
    }

    async function deleteAsset(): Promise<void> {
        if (!editingAsset) return;
        await removeAsset(editingAsset);
        notify.success("Asset deleted");
        editingAssetId = null;
    }

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
<section class="readout-shell shrink-0" class:sheet aria-label="Outlook">
    <div class="readout" class:open={assetsOpen || sheet} class:sheet>
        <div class="cell lead">
            {#if railVisible && !sheet}
                <div class="cell-static">
                    {#if linked}
                        <Metric label="Available now" size="lg" unit="Kč" detail={overview.breakdown}>
                            <DataValue>{formatAmount(outlook.available)}</DataValue>
                            {#snippet delta()}{#if overview.stamp}<span class="stamp {overview.tone}"><span class="dot"></span>{overview.stamp}</span>{/if}{/snippet}
                        </Metric>
                    {:else}
                        <Metric label="Available now" size="lg" unit="Kč" detail={assetNames || "Add current assets"}>
                            <DataValue>{formatAmount(outlook.available)}</DataValue>
                        </Metric>
                    {/if}
                </div>
            {:else}
                <button type="button" class="cell-button" aria-expanded={assetsOpen} aria-controls="finance-current-assets" aria-label="Available now" onclick={() => (assetsOpen = !assetsOpen)}>
                    {#if linked}
                        <Metric label="Available now" size="lg" unit="Kč" detail={overview.breakdown}>
                            <DataValue>{formatAmount(outlook.available)}</DataValue>
                            {#snippet delta()}{#if overview.stamp}<span class="stamp {overview.tone}"><span class="dot"></span>{overview.stamp}</span>{/if}{/snippet}
                        </Metric>
                    {:else}
                        <Metric label="Available now" size="lg" unit="Kč" detail={assetNames || "Add current assets"}>
                            <DataValue>{formatAmount(outlook.available)}</DataValue>
                        </Metric>
                    {/if}
                    <IconChevronDown class="chevron h-4 w-4 shrink-0 transition-transform {assetsOpen ? 'rotate-180' : ''}" />
                </button>
            {/if}
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
            <Metric label="Safety floor" unit="Kč" detail="Warn below this balance">
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
    </div>

    <div class="spark-band" class:sheet>
        <RunwaySparkline points={runway} {outlook} {today} {floor} compact={sheet} {onJump} />
    </div>
</section>

{#if sheet && onUpdateAssets}
    <!-- The sheet lists the assets; Update assets opens every balance in one place. -->
    <div id="finance-current-assets" class="mt-3 flex flex-col">
        <p class="text-xs font-semibold uppercase tracking-wide text-[var(--stor-muted-text)]">Assets</p>
        {#each accounts as account (account.id)}
            {#if account.linked}
                <button type="button" class="sheet-account" onclick={() => (openAccountId = account.id)}>
                    <BankMark mark={account.bank?.mark ?? ""} />
                    <span class="flex min-w-0 flex-1 flex-col text-left">
                        <span class="truncate text-[var(--stor-ink)]">{account.name}</span>
                        <span class="sheet-detail {account.tone}">{account.tone === "ok" ? account.detail : account.stamp}</span>
                    </span>
                    <b class="shrink-0 font-semibold tabular-nums" class:text-[var(--stor-faint-text)]={account.frozen}>{formatAmount(account.available)} Kč</b>
                </button>
            {:else}
                <div class="flex min-h-12 items-center justify-between gap-3 border-b border-[color-mix(in_srgb,var(--stor-border)_62%,transparent)] text-[15px]">
                    {#if linked}<BankMark />{/if}
                    <span class="min-w-0 flex-1 truncate text-[var(--stor-ink)]">{account.name}</span>
                    <b class="shrink-0 font-semibold tabular-nums text-[var(--stor-ink)]">{formatAmount(account.balance)} Kč</b>
                </div>
            {/if}
        {:else}
            <p class="py-3 text-sm text-[var(--stor-muted-text)]">No assets yet.</p>
        {/each}
        <button type="button" class="flex min-h-12 items-center justify-between text-left text-[15px] font-semibold text-[var(--stor-accent-text)]" onclick={onUpdateAssets}>
            {assets.length ? "Update assets" : "Add an asset"}<IconChevronDown class="h-5 w-5 -rotate-90" />
        </button>
    </div>
{:else if assetsOpen && !railVisible && linked}
    <div id="finance-current-assets" class="shrink-0">
        <AccountsStrip {accounts} onOpen={openFromStrip} onAdd={() => (addingAsset = true)} onLink={() => (linking = true)} onUpdateAll={onUpdateAssets} />
    </div>
{:else if assetsOpen && !railVisible}
    <div id="finance-current-assets" class="shrink-0">
        <AssetView {assets} {assetsSum} onUpdateAll={onUpdateAssets} onLink={() => (linking = true)} />
    </div>
{/if}

<LinkBankDrawer show={linking} {assets} {connections} {mails} {today} {assetsSum} onClose={() => (linking = false)} />

{#if linked}
    <AccountDrawer
        show={!!openAccount}
        account={openAccount}
        asset={openAsset}
        connection={connections.find((connection) => connection.id === openAsset?.connection_id) ?? null}
        mails={mails.filter((mail) => mail.mail_kind === "unread" && !!openAsset && mail.connection_id === openAsset.connection_id)}
        {assets}
        {today}
        {now}
        onClose={() => (openAccountId = null)}
    />
    <AssetDrawer
        show={addingAsset || !!editingAsset}
        asset={editingAsset}
        onClose={() => { addingAsset = false; editingAssetId = null; }}
        onSave={saveAsset}
        onDelete={deleteAsset}
    />
{/if}

<style>
    .readout-shell:not(.sheet) {
        overflow: hidden;
        border-block: 1px solid var(--stor-border);
    }
    .readout {
        display: grid;
        grid-template-columns: 1.5fr repeat(3, minmax(0, 1fr));
    }
    .cell { position: relative; min-width: 0; padding: 0.875rem 1.25rem; border-left: 1px solid var(--stor-border); }
    .cell:first-child { border-left: 0; padding-left: 0; }
    .cell-static { padding: 0.875rem 1.25rem; }
    .spark-band { padding: 0 1.25rem 0.75rem; }
    .spark-band.sheet { padding: 0.5rem 0.25rem 0; }
    /* From 640px the outlook + sparkline is one calm editorial card. */
    @media (min-width: 640px) {
        .readout-shell:not(.sheet) {
            border: 1px solid var(--stor-hairline);
            border-radius: var(--stor-section-radius);
            background: var(--stor-surface);
            box-shadow: var(--stor-elevation-1);
        }
        .readout:not(.sheet) .cell { border-left-color: var(--stor-rule); }
        .readout:not(.sheet) .cell:first-child { padding-left: 0; }
        .readout:not(.sheet) .lead .cell-button { padding-left: 1.25rem; }
    }
    .cell:has(> .cell-button),
    .cell:has(> .cell-static) { padding: 0; }
    .cell-button {
        position: relative;
        display: block;
        width: 100%;
        height: 100%;
        padding: 0.875rem 1.25rem;
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
    .stamp { display: inline-flex; align-items: center; gap: 6px; margin-right: 6px; font-weight: 500; }
    .stamp .dot { width: 6px; height: 6px; flex: none; border-radius: 50%; background: var(--stor-positive); }
    .stamp.stale { color: var(--stor-warning); }
    .stamp.stale .dot { background: var(--stor-warning); }
    .stamp.dead { color: var(--stor-negative); }
    .stamp.dead .dot { background: var(--stor-negative); }
    .sheet-account { display: flex; width: 100%; min-height: 3.5rem; align-items: center; gap: 0.75rem; border: 0; border-bottom: 1px solid color-mix(in srgb, var(--stor-border) 62%, transparent); background: transparent; font-size: 15px; color: var(--stor-ink); }
    .sheet-detail { overflow: hidden; font-size: 12px; line-height: 16px; color: var(--stor-faint-text); text-overflow: ellipsis; white-space: nowrap; }
    .sheet-detail.stale { color: var(--stor-warning); }
    .sheet-detail.dead { color: var(--stor-negative); }
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
