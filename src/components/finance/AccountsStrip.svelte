<script lang="ts">
    import { formatAmount } from "@hearthlog/sdk/format";
    import { CommandOnly, DataValue } from "@hearthlog/sdk/ui";
    import type { AccountSummary } from "../../finance/accounts.js";
    import BankMark from "./BankMark.svelte";
    import IconPlus from "~icons/mdi/plus";

    /**
     * Every account and asset under the readout, linked first: balance, kind and how fresh it is, or the state that
     * needs a look. The sum above is all of them, a card as debt.
     */
    let {
        accounts,
        onOpen,
        onAdd,
        onUpdateAll,
    }: {
        accounts: AccountSummary[];
        onOpen: (account: AccountSummary) => void;
        onAdd: () => void;
        /** Opens every hand-kept balance in one sheet. */
        onUpdateAll?: () => void;
    } = $props();

    const handKept = $derived(accounts.filter((account) => !account.linked).length);
</script>

<div class="strip-card">
    <ul class="accounts">
        {#each accounts as account (account.id)}
            <li>
                <button type="button" class="account" class:frozen={account.frozen} onclick={() => onOpen(account)} aria-label={`${account.name}, ${formatAmount(account.balance)} Kč, ${account.detail}`}>
                    <span class="name"><BankMark mark={account.bank?.mark ?? ""} /><span>{account.name}</span></span>
                    <span class="balance" class:negative={account.balance < 0}><DataValue>{formatAmount(account.balance)}</DataValue><small>Kč</small></span>
                    {#if account.tone === "ok" || account.tone === "hand"}
                        <span class="detail">{account.detail}</span>
                    {:else}
                        <span class="stamp {account.tone}"><span class="dot"></span>{account.stamp}</span>
                    {/if}
                </button>
            </li>
        {/each}
    </ul>
    <div class="foot">
        <span class="caption">One sum: every account and asset counts, the card as debt.</span>
        <CommandOnly>
            <span class="actions">
                {#if import.meta.env.DEV}{#await import("../../dev/DevBankPanel.svelte") then dev}<dev.default />{/await}{/if}
                {#if onUpdateAll && handKept > 1}
                    <button type="button" class="quiet" onclick={onUpdateAll}>Update balances</button>
                {/if}
                <button type="button" class="add" onclick={onAdd}><IconPlus class="h-3.5 w-3.5" />Add asset</button>
            </span>
        </CommandOnly>
    </div>
</div>

<style>
    .strip-card {
        overflow: hidden;
        border: 1px solid var(--stor-hairline);
        border-radius: var(--stor-section-radius);
        background: var(--stor-surface);
        box-shadow: var(--stor-elevation-1);
    }
    /* Each account draws the hairlines on its left and top; the list clips the ones on the outer edge, so any number
       of accounts wraps cleanly and an unfilled last row stays plain surface. */
    .accounts {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(10.5rem, 1fr));
        overflow: hidden;
        margin: 0;
        padding: 0;
        list-style: none;
    }
    .accounts li { min-width: 0; box-shadow: -1px 0 0 var(--stor-rule), 0 -1px 0 var(--stor-rule); }
    .account {
        display: flex;
        width: 100%;
        height: 100%;
        flex-direction: column;
        gap: 6px;
        padding: 14px 16px;
        border: 0;
        background: transparent;
        text-align: left;
        color: inherit;
    }
    .account:hover { background: var(--stor-surface-hover); }
    .account:focus-visible { outline: 2px solid var(--stor-focus); outline-offset: -2px; }
    .name { display: flex; min-width: 0; align-items: center; gap: 8px; font-size: 13px; line-height: 18px; font-weight: 500; color: var(--stor-ink); white-space: nowrap; }
    .name span:last-child { overflow: hidden; text-overflow: ellipsis; }
    .balance { font-size: 17px; line-height: 22px; font-weight: 600; letter-spacing: -0.015em; color: var(--stor-ink); white-space: nowrap; font-variant-numeric: tabular-nums; }
    .balance small { margin-left: 3px; font-size: 11px; font-weight: 600; color: var(--stor-muted-text); }
    .balance.negative { color: var(--stor-negative); }
    .frozen .balance { color: var(--stor-faint-text); }
    .detail { overflow: hidden; font-size: 12px; line-height: 16px; color: var(--stor-faint-text); text-overflow: ellipsis; white-space: nowrap; }
    .stamp { display: inline-flex; min-width: 0; align-items: center; gap: 6px; overflow: hidden; font-size: 12px; line-height: 16px; font-weight: 500; white-space: nowrap; text-overflow: ellipsis; }
    .stamp .dot { width: 6px; height: 6px; flex: none; border-radius: 50%; background: currentColor; }
    .stamp.stale { color: var(--stor-warning); }
    .stamp.dead { color: var(--stor-negative); }
    .foot {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        justify-content: space-between;
        gap: 8px 12px;
        padding: 10px 16px;
        border-top: 1px solid var(--stor-rule);
        background: var(--stor-surface-muted);
    }
    .caption { font-size: 12px; line-height: 16px; color: var(--stor-muted-text); }
    .actions { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
    .actions button { display: inline-flex; height: 30px; align-items: center; gap: 6px; padding: 0 10px; border: 0; border-radius: 9px; font-size: 12px; font-weight: 600; }
    .quiet { background: transparent; color: var(--stor-accent-text); }
    .add { background: var(--stor-surface-raised); box-shadow: var(--stor-elevation-2); color: var(--stor-ink); }
</style>
