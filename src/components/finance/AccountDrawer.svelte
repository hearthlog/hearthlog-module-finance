<script lang="ts">
    import { endOfMonth, format, parseISO, startOfMonth } from "date-fns";
    import { formatAmount } from "@hearthlog/sdk/format";
    import { executeLocalCommand, queryDatabase, type Transaction, type UpdateBankMailEvent } from "@hearthlog/sdk/data";
    import { notify } from "@hearthlog/sdk/runtime";
    import { Button, CommandConfirmDialog, CommandDrawer, CommandOnly, DataValue } from "@hearthlog/sdk/ui";
    import type { Asset, BankConnection, BankMail } from "../../data/assets.js";
    import { ago, kindLong, QUIET_DAYS, type AccountSummary } from "../../finance/accounts.js";
    import { acceptBalanceGap, unlinkAsset } from "../../finance/account-commands.js";
    import { PROVIDER_LABELS } from "../../finance/banks.js";
    import { categoryLabel } from "../../finance/categories.js";
    import BankMark from "./BankMark.svelte";
    import StatementImport from "./StatementImport.svelte";

    /** One linked account: its balance and how fresh it is, what needs a look, this month's rows, and the connection. */
    let {
        show,
        account,
        asset,
        connection,
        mails = [],
        assets = [],
        today,
        now,
        onClose,
    }: {
        show: boolean;
        account: AccountSummary | null;
        asset: Asset | null;
        connection: BankConnection | null;
        /** This bank's mails Finance could not read, still open. */
        mails?: BankMail[];
        /** Every asset, to place a statement's rows. */
        assets?: Asset[];
        today: string;
        now: Date;
        onClose: () => void;
    } = $props();

    let rows = $state<Transaction[]>([]);
    let planNames = $state<Record<string, string>>({});
    let busy = $state(false);
    let confirmUnlink = $state(false);

    const email = $derived(account?.provider === "email");
    const bankName = $derived(account?.bank?.name ?? "the bank");
    const description = $derived(account ? [kindLong(account.kind), account.tail ? `•••• ${account.tail}` : "", account.provider ? PROVIDER_LABELS[account.provider].long : ""].filter(Boolean).join(" · ") : "");
    const balanceLabel = $derived(!account ? "" : account.frozen ? "Last balance before the approval ended" : email ? "Balance, from the last email" : "Balance, from the bank");
    const stampNote = $derived(email && account?.state === "current" ? ` · ${bankName} states the balance in each one` : "");
    const toReview = $derived(rows.filter((row) => row.review === "new").length);
    const monthStart = $derived(today ? format(startOfMonth(parseISO(today)), "yyyy-MM-dd") : "");
    const monthEnd = $derived(today ? format(endOfMonth(parseISO(today)), "yyyy-MM-dd") : "");
    const gap = $derived(account?.state === "gap" ? Number(asset?.issue_amount) || 0 : 0);
    const day = (value: string | null | undefined, pattern = "d MMM yyyy") => (value ? format(parseISO(value.replace(" ", "T")), pattern) : "");

    $effect(() => {
        const id = show ? account?.id : undefined;
        const from = monthStart;
        const to = monthEnd;
        if (!id || !from) return;
        let cancelled = false;
        void queryDatabase(async (repositories) => {
            const found = await repositories.transactions.getAssetRows(id, from, to);
            const names = await repositories.transactions.namesOf([...new Set(found.map((row) => row.plan_match).filter(Boolean))]);
            return { found, names };
        }).then(({ found, names }) => {
            if (cancelled) return;
            rows = found;
            planNames = names;
        }).catch((error) => console.error("[AccountDrawer] Rows could not be read", error));
        return () => { cancelled = true; };
    });

    function rowNote(row: Transaction): { text: string; tone: "" | "warn" | "accent" } {
        const when = row.due_date.slice(0, 10) === today ? "Today" : format(parseISO(row.due_date.slice(0, 10)), "EEE d");
        if (row.plan_match) return { text: `${when} · may be your plan ${planNames[row.plan_match] || "a plan"}`, tone: "accent" };
        if (row.transaction_category === "transfer") return { text: `${when} · Transfer${row.review === "new" ? " ?" : ""}`, tone: "" };
        if (!row.transaction_category || row.transaction_category === "unknown") return { text: `${when} · Pick a category`, tone: "warn" };
        return { text: `${when} · ${categoryLabel(row.transaction_category)}`, tone: "" };
    }

    async function adjust(): Promise<void> {
        if (!asset || busy) return;
        busy = true;
        try {
            await acceptBalanceGap(asset, today);
            notify.success("Adjustment recorded");
        } catch (error) {
            console.error("[AccountDrawer] Adjustment failed", error);
            notify.error("The adjustment could not be saved");
        } finally {
            busy = false;
        }
    }

    let openMailId = $state<string | null>(null);

    async function dismiss(mail: BankMail): Promise<void> {
        try {
            await executeLocalCommand({ id: crypto.randomUUID(), type: "BANK_MAIL_UPDATED", timestamp: Date.now(), payload: { id: mail.id, status: "dismissed" } } satisfies UpdateBankMailEvent);
        } catch (error) {
            console.error("[AccountDrawer] Dismiss failed", error);
            notify.error("The email could not be dismissed");
        }
    }

    async function unlink(): Promise<void> {
        confirmUnlink = false;
        if (!asset) return;
        try {
            await unlinkAsset(asset);
            notify.success(`${asset.name} is kept by hand now`);
            onClose();
        } catch (error) {
            console.error("[AccountDrawer] Unlink failed", error);
            notify.error("The account could not be unlinked");
        }
    }
</script>

<CommandDrawer show={show && !!account} title={account?.name ?? ""} {description} {onClose}>
    {#if account}
        <div class="account-drawer">
            <div class="balance-block">
                <BankMark mark={account.bank?.mark ?? ""} size="lg" />
                <div class="stack">
                    <span class="over">{balanceLabel}</span>
                    <span class="figure" class:frozen={account.frozen} class:negative={account.balance < 0}><DataValue>{formatAmount(account.balance)}</DataValue><span class="unit">Kč</span></span>
                    <span class="stamp {account.tone}"><span class="dot"></span>{account.stamp}{stampNote}</span>
                </div>
            </div>

            {#if account.state === "gap"}
                <section class="group" aria-label="Balances do not add up">
                    <div class="group-head"><h3>The balances do not add up</h3><span>Found by itself</span></div>
                    <div class="card">
                        <div class="gap-grid">
                            <span><small>Rows add up to</small><b>{formatAmount(account.balance - gap)}</b></span>
                            <span><small>{bankName} says</small><b>{formatAmount(account.balance)}</b></span>
                            <span><small class="warn">Unexplained</small><b class="warn">{formatAmount(gap, { signed: true })}</b></span>
                        </div>
                        <div class="card-foot">
                            <span class="why">A payment came without an email. The bank's figure already counts; add the missing row in the list, or record the difference as an adjustment.</span>
                            <CommandOnly><Button size="sm" variant="secondary" disabled={busy} onclick={adjust}>Adjust only</Button></CommandOnly>
                        </div>
                    </div>
                </section>
            {:else if account.state === "unread"}
                <p class="note warn">{mails.length || 1} {mails.length > 1 ? "emails" : "email"} from {bankName} could not be read. Each is kept as it came: enter the row by hand from it, or dismiss it as not a payment. Nothing is guessed.</p>
            {:else if account.state === "quiet"}
                <p class="note warn">Nothing from {bankName} since {day(asset?.synced_at, "d MMM")}. Usually forwarding broke, or the account simply was not used. Check the balance to be sure.</p>
            {:else if account.state === "limit"}
                <p class="note warn">{bankName} allows a few background fetches a day; the next one is at {day(connection?.next_try_at, "HH:mm")}. Refreshing still works while you are in the app, because that fetch counts as yours.</p>
            {:else if account.state === "renew"}
                <p class="note warn">The approval at {bankName} ends on {day(connection?.valid_until, "d MMM")}. Renewing goes to {bankName} and back; until then everything keeps syncing.</p>
            {:else if account.state === "expired"}
                <p class="note negative">The approval at {bankName} has ended. The balance is frozen as of {day(asset?.synced_at, "d MMM")} and still counts in Available now, marked as old, until you renew or type it by hand.</p>
            {:else if account.state === "error"}
                <p class="note negative">{connection?.last_error || "The provider reported an error."}</p>
            {/if}

            {#if mails.length}
                <section class="group" aria-label="Emails not understood">
                    <div class="group-head"><h3>Emails not understood</h3><span>{mails.length}</span></div>
                    <div class="card list">
                        {#each mails as mail (mail.id)}
                            <div class="mail">
                                <div class="line">
                                    <button type="button" class="mail-open" aria-expanded={openMailId === mail.id} onclick={() => (openMailId = openMailId === mail.id ? null : mail.id)}>
                                        <span class="line-name">{mail.subject || "No subject"}</span>
                                        <small>{day(mail.received_at, "d MMM HH:mm")} · {mail.reason}</small>
                                    </button>
                                    <CommandOnly><Button size="sm" variant="secondary" onclick={() => dismiss(mail)}>Dismiss</Button></CommandOnly>
                                </div>
                                {#if openMailId === mail.id}<pre class="mail-text">{mail.body_text}</pre>{/if}
                            </div>
                        {/each}
                    </div>
                </section>
            {/if}

            <section class="group" aria-label="This month">
                <div class="group-head"><h3>This month</h3><span>{rows.length} {rows.length === 1 ? "row" : "rows"}{toReview ? ` · ${toReview} to review` : ""}</span></div>
                <div class="card list">
                    {#each rows as row (row.id)}
                        {@const note = rowNote(row)}
                        <div class="line">
                            <span class="line-main">
                                <span class="new-dot" class:off={row.review !== "new"} aria-label={row.review === "new" ? "Not reviewed yet" : undefined}></span>
                                <span class="stack"><span class="line-name">{row.name || row.bank_text || "Untitled"}</span><small class={note.tone}>{note.text}</small></span>
                            </span>
                            <span class="line-amount" class:muted={row.transaction_category === "transfer"}>{formatAmount(row.amount, { signed: row.amount > 0 })}</span>
                        </div>
                    {:else}
                        <p class="empty">No rows this month yet.</p>
                    {/each}
                </div>
            </section>

            <section class="group" aria-label="Connection">
                <div class="group-head"><h3>Connection</h3><span>{account.provider ? PROVIDER_LABELS[account.provider].long : ""}</span></div>
                <div class="card list">
                    {#if email}
                        <div class="kv"><span>Emails from</span><b>{account.bank?.senderDomain ?? "the bank"} <small>· signature checked</small></b></div>
                        <div class="kv"><span>Forwarded to</span><b>{connection?.address || "Not set up yet"}</b></div>
                        <div class="kv"><span>Usually arrive</span><b>With every payment <small>· warn after {QUIET_DAYS} quiet days</small></b></div>
                        <div class="kv"><span>Emails not understood</span><b>{mails.length || "None"}</b></div>
                        <div class="kv"><span>Rows since</span><b>{day(connection?.rows_since) || "The first email"}</b></div>
                    {:else}
                        <div class="kv"><span>Bank</span><b>{bankName}</b></div>
                        <div class="kv"><span>Approval valid until</span><b>{day(connection?.valid_until) || "Unknown"}</b></div>
                        <div class="kv"><span>Last sync</span><b>{ago(asset?.synced_at, now)}</b></div>
                        <div class="kv"><span>Background fetches</span><b>About 4 a day <small>· more while you are in the app</small></b></div>
                    {/if}
                    <div class="kv"><span>Counts in Available now</span><b>{account.frozen ? `Yes, as of ${day(asset?.synced_at, "d MMM")}` : "Yes"}</b></div>
                </div>
            </section>

            {#if email}
                <section class="group" aria-label="Add a statement file">
                    <div class="group-head"><h3>Earlier months</h3><span>From a statement</span></div>
                    <StatementImport {assets} {today} />
                </section>
            {/if}
        </div>
    {/if}
    {#snippet footer()}
        <CommandOnly>
            <Button variant="secondary" size="sm" class="unlink" onclick={() => (confirmUnlink = true)}>Unlink, keep as a hand-kept asset</Button>
        </CommandOnly>
        <Button size="sm" onclick={onClose}>Close</Button>
    {/snippet}
</CommandDrawer>

<CommandConfirmDialog
    show={confirmUnlink}
    title="Unlink this account"
    confirmLabel="Unlink"
    message={`${account?.name ?? "The account"} stays with its balance of ${formatAmount(account?.balance ?? 0)} Kč and its rows, kept by hand from now on. New payments will not arrive.`}
    onConfirm={unlink}
    onCancel={() => (confirmUnlink = false)}
/>

<style>
    .account-drawer { display: flex; flex-direction: column; gap: 20px; }
    .balance-block { display: flex; align-items: flex-start; gap: 12px; }
    .stack { display: flex; min-width: 0; flex-direction: column; gap: 2px; }
    .over { font-size: 11px; line-height: 16px; font-weight: 600; letter-spacing: 0.06em; text-transform: uppercase; color: var(--stor-muted-text); }
    .figure { font-size: 30px; line-height: 36px; font-weight: 600; letter-spacing: -0.02em; color: var(--stor-ink); font-variant-numeric: tabular-nums; }
    .figure .unit { margin-left: 4px; font-size: 0.55em; color: var(--stor-muted-text); }
    .figure.negative { color: var(--stor-negative); }
    .figure.frozen { color: var(--stor-faint-text); }
    .stamp { display: inline-flex; align-items: center; gap: 6px; font-size: 12px; line-height: 16px; font-weight: 500; color: var(--stor-muted-text); }
    .stamp .dot { width: 6px; height: 6px; flex: none; border-radius: 50%; background: var(--stor-positive); }
    .stamp.stale { color: var(--stor-warning); }
    .stamp.stale .dot { background: var(--stor-warning); }
    .stamp.dead { color: var(--stor-negative); }
    .stamp.dead .dot { background: var(--stor-negative); }
    .group { display: flex; flex-direction: column; gap: 10px; }
    .group-head { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; }
    .group-head h3 { margin: 0; font-size: 15px; line-height: 22px; font-weight: 600; }
    .group-head span { font-size: 12px; line-height: 16px; color: var(--stor-muted-text); }
    .card { display: flex; flex-direction: column; overflow: hidden; border: 1px solid var(--stor-hairline); border-radius: 14px; background: var(--stor-surface); box-shadow: var(--stor-elevation-1); }
    .card.list { padding: 0 16px; }
    .gap-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); }
    .gap-grid > span { display: flex; flex-direction: column; gap: 2px; padding: 12px 16px; font-variant-numeric: tabular-nums; }
    .gap-grid > span + span { border-left: 1px solid var(--stor-rule); }
    .gap-grid small { font-size: 12px; color: var(--stor-muted-text); }
    .gap-grid b { font-weight: 600; }
    .warn { color: var(--stor-warning) !important; font-weight: 600; }
    .card-foot { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 8px 12px; padding: 10px 12px 10px 16px; border-top: 1px solid var(--stor-rule); background: var(--stor-surface-muted); }
    .why { flex: 1 1 14rem; font-size: 12px; line-height: 16px; color: var(--stor-muted-text); }
    .note { margin: 0; padding: 10px 12px; border-radius: 10px; font-size: 12px; line-height: 18px; }
    .note.warn { background: var(--stor-warning-soft); font-weight: 500; }
    .note.negative { background: var(--stor-negative-soft); color: var(--stor-negative); }
    .line, .kv { display: flex; min-height: 44px; align-items: center; justify-content: space-between; gap: 12px; border-top: 1px solid var(--stor-rule); font-size: 13px; }
    .line:first-child, .kv:first-child { border-top: 0; }
    .line-main { display: flex; min-width: 0; align-items: center; gap: 10px; }
    .line-name { overflow: hidden; font-weight: 500; color: var(--stor-ink); text-overflow: ellipsis; white-space: nowrap; }
    .line small { font-size: 12px; line-height: 16px; color: var(--stor-faint-text); }
    .line small.accent { color: var(--stor-accent-text); }
    .line-amount { font-weight: 600; white-space: nowrap; font-variant-numeric: tabular-nums; }
    .line-amount.muted { color: var(--stor-muted-text); }
    .new-dot { width: 7px; height: 7px; flex: none; border-radius: 50%; background: var(--stor-action); }
    .new-dot.off { background: transparent; }
    .kv span { color: var(--stor-muted-text); }
    .kv b { font-weight: 500; color: var(--stor-ink); text-align: right; }
    .kv small { font-weight: 400; color: var(--stor-faint-text); }
    .mail { border-top: 1px solid var(--stor-rule); }
    .mail:first-child { border-top: 0; }
    .mail .line { border-top: 0; }
    .mail-open { display: flex; min-width: 0; flex-direction: column; align-items: flex-start; padding: 8px 0; border: 0; background: transparent; text-align: left; color: inherit; }
    .mail-open small { font-size: 12px; color: var(--stor-warning); }
    .mail-text { max-height: 16rem; overflow: auto; margin: 0 0 12px; padding: 10px; border-radius: 10px; background: var(--stor-surface-muted); font: 12px/17px var(--stor-font-sans, inherit); white-space: pre-wrap; }
    .empty { margin: 0; padding: 14px 0; font-size: 13px; color: var(--stor-muted-text); }
    :global(.unlink) { color: var(--stor-negative) !important; }
</style>
