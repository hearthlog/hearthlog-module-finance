<script lang="ts">
    import { format, parseISO } from "date-fns";
    import type { Asset, BankConnection, BankMail } from "../../data/assets.js";
    import type { MonthFlow } from "../../data/finance-timeline.js";
    import { orderAccounts, overviewOf, summarizeAccount, withUnreadMail, type AccountSummary } from "../../finance/accounts.js";
    import { removeAsset, saveHandKeptAsset } from "../../finance/account-commands.js";
    import { appClock, notify } from "@hearthlog/sdk/runtime";
    import { formatAmount } from "@hearthlog/sdk/format";
    import { CommandOnly, DataValue } from "@hearthlog/sdk/ui";
    import BankMark from "./BankMark.svelte";
    import AccountDrawer from "./AccountDrawer.svelte";
    import AssetDrawer from "./AssetDrawer.svelte";
    import LinkBankDrawer from "./LinkBankDrawer.svelte";
    import IconPlus from "~icons/mdi/plus";

    let {
        assets,
        assetsSum,
        connections = [],
        mails = [],
        today,
        monthFlow,
        reviewPending = 0,
        uncategorized = 0,
        onOpenReview,
        onOpenSort,
        onUpdateAssets,
    }: {
        assets: Asset[];
        assetsSum: number;
        connections?: BankConnection[];
        mails?: BankMail[];
        today: string;
        monthFlow: MonthFlow;
        reviewPending?: number;
        uncategorized?: number;
        onOpenReview: () => void;
        onOpenSort: () => void;
        onUpdateAssets?: () => void;
    } = $props();

    const now = $derived.by(() => { void assets; void connections; return appClock.now(); });
    const accountAssets = $derived(withUnreadMail(assets, mails));
    const accounts = $derived.by<AccountSummary[]>(() => orderAccounts(accountAssets.map((asset) =>
        summarizeAccount(asset, connections.find((connection) => connection.id === asset.connection_id) ?? null, now))));
    const overview = $derived(overviewOf(accounts, accountAssets, now));
    const handKept = $derived(accounts.filter((account) => !account.linked).length);

    let linking = $state(false);
    let openAccountId = $state<string | null>(null);
    let editingAssetId = $state<string | null>(null);
    let addingAsset = $state(false);

    const openAccount = $derived(accounts.find((account) => account.id === openAccountId) ?? null);
    const openAsset = $derived(accountAssets.find((asset) => asset.id === openAccountId) ?? null);
    const editingAsset = $derived(assets.find((asset) => asset.id === editingAssetId) ?? null);

    function openAccountItem(account: AccountSummary): void {
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

    const monthName = $derived(today && /^\d{4}-\d{2}-\d{2}$/.test(today) ? format(parseISO(today), "MMMM") : "This month");
    const income = $derived(Math.max(0, monthFlow.income));
    const spent = $derived(Math.abs(Math.min(0, monthFlow.expense)));
    const net = $derived(income - spent);
    const totalVol = $derived(income + spent);
    const incomePct = $derived(totalVol > 0 ? Math.round((income / totalVol) * 100) : 50);
    const savingsRate = $derived(income > 0 ? Math.round((net / income) * 100) : 0);
</script>

<aside class="rail" aria-label="Accounts and status">
    {#if reviewPending > 0 || uncategorized > 0}
        <section class="rail-card">
            <div class="rail-head">
                <span class="rail-title">Needs attention</span>
            </div>
            <div class="attention-list">
                {#if reviewPending > 0}
                    <button type="button" class="attention-item" onclick={onOpenReview}>
                        <span class="att-copy">
                            <strong>Review bank activity</strong>
                            <span>Matched plans, transfers and new rows</span>
                        </span>
                        <span class="count-pill">{reviewPending}</span>
                    </button>
                {/if}
                {#if uncategorized > 0}
                    <CommandOnly>
                        <button type="button" class="attention-item" onclick={onOpenSort}>
                            <span class="att-copy">
                                <strong>Sort uncategorized</strong>
                                <span>Give this month's rows a category</span>
                            </span>
                            <span class="count-pill warn">{uncategorized}</span>
                        </button>
                    </CommandOnly>
                {/if}
            </div>
        </section>
    {/if}

    <section class="rail-card">
        <div class="rail-head">
            <span class="rail-title">Accounts</span>
            {#if overview.linked > 0}
                <span class="sync-badge {overview.tone}">
                    <span class="dot"></span>{overview.linked} linked
                </span>
            {:else}
                <span class="sync-badge">{accounts.length} {accounts.length === 1 ? "asset" : "assets"}</span>
            {/if}
        </div>

        <div class="acct-list">
            {#each accounts as account (account.id)}
                <button
                    type="button"
                    class="acct-row"
                    class:frozen={account.frozen}
                    onclick={() => openAccountItem(account)}
                >
                    <BankMark mark={account.bank?.mark ?? ""} />
                    <span class="acct-info">
                        <span class="acct-name">{account.name}</span>
                        <span class="acct-sub {account.tone}">
                            {#if account.tone === "stale" || account.tone === "dead"}
                                <span class="dot"></span>{account.stamp}
                            {:else}
                                {account.detail}
                            {/if}
                        </span>
                    </span>
                    <span class="acct-bal" class:neg={account.available < 0}>
                        <DataValue>{formatAmount(account.available)}</DataValue><small>Kč</small>
                    </span>
                </button>
            {:else}
                <p class="empty-copy">No accounts or assets yet.</p>
            {/each}
        </div>

        <CommandOnly>
            <div class="rail-foot">
                <button type="button" class="foot-btn primary" onclick={() => (linking = true)}>
                    <IconPlus class="h-3.5 w-3.5" /> Link bank
                </button>
                <button type="button" class="foot-btn" onclick={() => (addingAsset = true)}>
                    <IconPlus class="h-3.5 w-3.5" /> Asset
                </button>
                {#if onUpdateAssets && handKept > 1}
                    <button type="button" class="foot-btn quiet" onclick={onUpdateAssets}>Edit all</button>
                {/if}
                {#if import.meta.env.DEV}
                    {#await import("../../dev/DevBankPanel.svelte") then dev}
                        <dev.default />
                    {/await}
                {/if}
            </div>
        </CommandOnly>
    </section>

    <section class="rail-card">
        <div class="rail-head">
            <span class="rail-title">{monthName} flow</span>
            <span class="flow-net" class:pos={net > 0} class:neg={net < 0}>
                <DataValue>{formatAmount(net, { signed: true })} Kč</DataValue>
            </span>
        </div>
        <div class="pulse-bar" aria-hidden="true">
            <div class="pulse-in" style:width={`${incomePct}%`}></div>
            <div class="pulse-out" style:width={`${100 - incomePct}%`}></div>
        </div>
        <div class="pulse-grid">
            <div>
                <span>Income</span>
                <strong class="pos"><DataValue>+{formatAmount(income)}</DataValue></strong>
            </div>
            <div>
                <span>Spent</span>
                <strong><DataValue>−{formatAmount(spent)}</DataValue></strong>
            </div>
            <div>
                <span>Saved</span>
                <strong>{income > 0 ? `${savingsRate}%` : "—"}</strong>
            </div>
        </div>
    </section>
</aside>

<LinkBankDrawer show={linking} {assets} {connections} {mails} {today} {assetsSum} onClose={() => (linking = false)} />

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

<style>
    .rail {
        display: flex;
        flex-direction: column;
        gap: 12px;
        min-width: 0;
        overflow-y: auto;
    }
    .rail-card {
        padding: 14px 16px;
        border: 1px solid var(--stor-hairline);
        border-radius: var(--stor-section-radius);
        background: var(--stor-surface);
        box-shadow: var(--stor-elevation-1);
    }
    .rail-head {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
        margin-bottom: 10px;
    }
    .rail-title {
        font-size: 11px;
        font-weight: 650;
        text-transform: uppercase;
        letter-spacing: 0.07em;
        color: var(--stor-muted-text);
    }
    .sync-badge {
        display: inline-flex;
        align-items: center;
        gap: 5px;
        font-size: 11.5px;
        color: var(--stor-muted-text);
    }
    .dot {
        width: 6px;
        height: 6px;
        border-radius: 50%;
        flex: none;
        background: var(--stor-positive);
    }
    .stale .dot { background: var(--stor-warning); }
    .dead .dot { background: var(--stor-negative); }

    .attention-list {
        display: flex;
        flex-direction: column;
        gap: 7px;
    }
    .attention-item {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 10px;
        width: 100%;
        padding: 9px 10px;
        border: 1px solid transparent;
        border-radius: 11px;
        background: var(--stor-surface-muted);
        text-align: left;
    }
    .attention-item:hover {
        background: var(--stor-accent-soft);
    }
    .att-copy {
        min-width: 0;
        display: flex;
        flex-direction: column;
    }
    .att-copy strong {
        font-size: 13px;
        font-weight: 600;
        color: var(--stor-ink);
    }
    .att-copy span {
        font-size: 11.5px;
        color: var(--stor-muted-text);
    }
    .count-pill {
        min-width: 24px;
        height: 24px;
        padding: 0 7px;
        border-radius: 999px;
        background: var(--stor-action);
        color: var(--stor-action-text, #fff);
        font-size: 11.5px;
        font-weight: 700;
        display: inline-grid;
        place-items: center;
        flex: none;
    }
    .count-pill.warn {
        background: var(--stor-warning-soft);
        color: var(--stor-warning);
    }

    .acct-list {
        display: flex;
        flex-direction: column;
        margin: 0 -8px;
    }
    .acct-row {
        display: flex;
        align-items: center;
        gap: 10px;
        width: 100%;
        padding: 8px;
        border: 0;
        border-radius: 10px;
        background: transparent;
        text-align: left;
    }
    .acct-row:hover { background: var(--stor-surface-hover); }
    .acct-info {
        min-width: 0;
        flex: 1;
        display: flex;
        flex-direction: column;
    }
    .acct-name {
        font-size: 13px;
        font-weight: 550;
        color: var(--stor-ink);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
    }
    .acct-sub {
        display: inline-flex;
        align-items: center;
        gap: 5px;
        font-size: 11px;
        color: var(--stor-faint-text);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
    }
    .acct-sub.stale { color: var(--stor-warning); font-weight: 500; }
    .acct-sub.dead { color: var(--stor-negative); font-weight: 500; }
    .acct-bal {
        font-size: 13px;
        font-weight: 600;
        color: var(--stor-ink);
        white-space: nowrap;
        font-variant-numeric: tabular-nums;
    }
    .acct-bal small {
        margin-left: 2px;
        font-size: 10.5px;
        font-weight: 500;
        color: var(--stor-muted-text);
    }
    .acct-bal.neg { color: var(--stor-negative); }
    .frozen .acct-bal { color: var(--stor-faint-text); }
    .empty-copy {
        padding: 8px;
        font-size: 12.5px;
        color: var(--stor-muted-text);
    }

    .rail-foot {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 6px;
        margin-top: 10px;
        padding-top: 10px;
        border-top: 1px solid var(--stor-rule);
    }
    .foot-btn {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: 4px;
        height: 30px;
        padding: 0 10px;
        border: 1px solid var(--stor-hairline);
        border-radius: 9px;
        background: var(--stor-surface-raised);
        font-size: 12px;
        font-weight: 600;
        color: var(--stor-ink);
    }
    .foot-btn.primary { flex: 1; }
    .foot-btn.quiet {
        border-color: transparent;
        background: transparent;
        color: var(--stor-accent-text);
    }
    .foot-btn:hover { background: var(--stor-surface-hover); }

    .flow-net {
        font-size: 12px;
        font-weight: 650;
        color: var(--stor-ink);
    }
    .flow-net.pos, .pos { color: var(--stor-positive); }
    .flow-net.neg { color: var(--stor-negative); }

    .pulse-bar {
        display: flex;
        height: 7px;
        border-radius: 999px;
        background: var(--stor-surface-well);
        overflow: hidden;
        margin-bottom: 10px;
    }
    .pulse-in { height: 100%; background: var(--stor-positive); }
    .pulse-out { height: 100%; background: var(--stor-action); }

    .pulse-grid {
        display: grid;
        grid-template-columns: repeat(3, minmax(0, 1fr));
        gap: 6px;
        font-size: 11.5px;
    }
    .pulse-grid span {
        display: block;
        color: var(--stor-faint-text);
    }
    .pulse-grid strong {
        font-size: 12.5px;
        font-weight: 600;
        color: var(--stor-ink);
    }
</style>
