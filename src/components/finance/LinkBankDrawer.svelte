<script lang="ts">
    import { untrack } from "svelte";
    import { format, parseISO } from "date-fns";
    import { formatAmount } from "@hearthlog/sdk/format";
    import { executeLocalCommand, type RemoveAssetEvent, type UpdateAssetEvent, type UpdateBankMailEvent } from "@hearthlog/sdk/data";
    import { notify } from "@hearthlog/sdk/runtime";
    import { Button, CommandDrawer } from "@hearthlog/sdk/ui";
    import type { Asset, BankConnection, BankMail } from "../../data/assets.js";
    import { kindLabel } from "../../finance/accounts.js";
    import { BANK_LIST, type BankInfo } from "../../finance/banks.js";
    import BankMark from "./BankMark.svelte";
    import { startBankApproval } from "../../finance/bank-approval.js";
    import StatementImport from "./StatementImport.svelte";

    /**
     * Linking a bank by its notification emails, as on the Link board: pick the bank, forward its mails to the site's
     * private address (the mailbox's confirmation code shows up here), then name the account the first mail is about
     * (or let it replace a hand-kept asset) and, if wanted, add earlier months from a statement.
     */
    let {
        show,
        assets,
        connections,
        mails,
        today,
        assetsSum,
        onClose,
    }: {
        show: boolean;
        assets: Asset[];
        connections: BankConnection[];
        mails: BankMail[];
        today: string;
        assetsSum: number;
        onClose: () => void;
    } = $props();

    const INSTRUCTIONS: Record<string, string> = {
        csob: "In ČSOB internet banking, turn on the “Moje info” email notice for every payment on the account, incoming and outgoing.",
        airbank: "In the Air Bank app, turn on email notifications for every payment on the account, incoming and outgoing.",
    };

    let step = $state(1);
    let bankId = $state("csob");
    let openedAt = $state("");
    let addresses = $state<Array<{ integrationId: string; address: string }> | null>(null);
    let addressError = $state("");
    /** The site has the Enable Banking secrets and an approval integration. */
    let approvalReady = $state(false);
    let leaving = $state(false);
    let replaceId = $state("");
    let kind = $state("current");
    let busy = $state(false);
    let copied = $state("");

    const bank = $derived<BankInfo>(BANK_LIST.find((candidate) => candidate.id === bankId) ?? BANK_LIST[0]!);
    const address = $derived(addresses?.[0]?.address ?? "");
    const confirmation = $derived(mails.find((mail) => mail.mail_kind === "confirmation" && mail.status === "open") ?? null);
    const confirmationUnverified = $derived(!!confirmation && confirmation.reason.startsWith("Forwarding confirmation, signature not verified"));
    /** Mails that reached the address but could not be read, since shortly before this step opened: shown, never lost. */
    const unreadSince = $derived(openedAt
        ? mails.filter((mail) => mail.mail_kind === "unread" && mail.status === "open" && (mail.received_at ?? "") >= new Date(Date.parse(openedAt) - 30 * 60_000).toISOString())
        : []);
    let openUnreadId = $state<string | null>(null);
    /** The bank's connection, once a mail reached it after this step opened (every mail refreshes it, a late one too). */
    const reached = $derived(openedAt ? connections.find((connection) => connection.bank === bankId && (connection.last_sync_at ?? "") >= openedAt) ?? null : null);
    /** The account that mail is about: the connection's most recently refreshed one. */
    const arrived = $derived(reached
        ? assets.filter((asset) => asset.link === "bank" && asset.connection_id === reached.id)
            .sort((a, b) => String(b.synced_at).localeCompare(String(a.synced_at)))[0] ?? null
        : null);
    const handKept = $derived(assets.filter((asset) => asset.link !== "bank"));
    const replacing = $derived(handKept.find((asset) => asset.id === replaceId) ?? null);
    const tail = $derived(arrived ? arrived.account_hash.replace(/\D/g, "").slice(-4) : "");

    $effect(() => {
        if (!show) return;
        step = 1;
        openedAt = new Date(Date.now() - 60_000).toISOString();
        replaceId = "";
        kind = "current";
        if (untrack(() => addresses) !== null) return;
        void fetch("/api/finance/bank/v1/addresses", { credentials: "same-origin", headers: { Accept: "application/json" } })
            .then(async (response) => {
                if (!response.ok) throw new Error(String(response.status));
                const body = await response.json() as { addresses: Array<{ integrationId: string; address: string }>; configured: boolean; approval?: boolean };
                addresses = body.addresses;
                approvalReady = !!body.approval;
                if (!body.configured) addressError = "This site has no mail subdomain yet. It needs a domain on Cloudflare with Email Routing sending a subdomain's mail to the site (see Finance's setup notes).";
                else if (!body.addresses.length) addressError = "No bank mail integration is configured for this site yet.";
            })
            .catch(() => {
                addresses = [];
                addressError = "The forwarding address could not be loaded here.";
            });
    });

    // The kind starts as the provider guessed it, once per account that arrives; the user's pick then stays.
    let kindFor = "";
    $effect(() => {
        const account = arrived;
        if (!account || account.id === kindFor) return;
        kindFor = account.id;
        kind = account.account_kind || "current";
    });

    async function copy(text: string, what: string): Promise<void> {
        try {
            await navigator.clipboard.writeText(text);
            copied = what;
            setTimeout(() => (copied = ""), 1500);
        } catch {
            notify.error("Could not copy; select the text instead");
        }
    }

    async function link(): Promise<void> {
        if (!arrived) return;
        busy = true;
        try {
            await executeLocalCommand({
                id: crypto.randomUUID(),
                type: "ASSET_UPDATED",
                timestamp: Date.now(),
                payload: { id: arrived.id, account_kind: kind, ...(replacing ? { name: replacing.name } : {}) },
            } satisfies UpdateAssetEvent);
            if (replacing) {
                await executeLocalCommand({ id: crypto.randomUUID(), type: "ASSET_REMOVED", timestamp: Date.now(), payload: { id: replacing.id } } satisfies RemoveAssetEvent);
            }
            // The forwarding works: its confirmation needs no more attention.
            for (const mail of mails.filter((entry) => entry.mail_kind === "confirmation" && entry.status === "open")) {
                await executeLocalCommand({ id: crypto.randomUUID(), type: "BANK_MAIL_UPDATED", timestamp: Date.now(), payload: { id: mail.id, status: "dismissed" } } satisfies UpdateBankMailEvent);
            }
            step = 4;
        } catch (error) {
            console.error("[LinkBank]", error);
            notify.error("The account could not be linked");
        } finally {
            busy = false;
        }
    }
</script>

<CommandDrawer {show} title="Link a bank account" description={`Step ${step} of 4`} {onClose}>
    <div class="link">
        {#if step === 1}
            <div class="options" role="radiogroup" aria-label="Bank">
                {#each BANK_LIST as option (option.id)}
                    {@const ready = option.provider === "email" || approvalReady}
                    <label class="option" class:disabled={!ready}>
                        <input type="radio" name="bank" value={option.id} bind:group={bankId} disabled={!ready} />
                        <BankMark mark={option.mark} size="lg" />
                        <span class="stack"><b>{option.name}</b><small>{option.provider === "email" ? "By notification email · within minutes" : ready ? "By bank approval · about 4 times a day" : "By bank approval · not set up for this site"}</small></span>
                    </label>
                {/each}
                <div class="option disabled"><BankMark size="lg" /><span class="stack"><b>Česká spořitelna, Fio and other banks</b><small>Later, one bank at a time</small></span></div>
            </div>
            <p class="note">Finance only reads. It cannot pay or move money, and it never asks for your bank password.</p>
        {:else if step === 2 && bank.provider === "enable_banking"}
            <p><b>Approve read access at {bank.name}.</b> You go to {bank.name}, sign in there and choose which accounts Finance may read; then you come back here and the accounts appear with their balances and recent rows.</p>
            <p class="note">The approval lasts as long as {bank.name} allows (up to 180 days) and can be renewed. Finance fetches about four times a day, and once more whenever you open it.</p>
        {:else if step === 2}
            <p>{INSTRUCTIONS[bank.id] ?? ""}</p>
            <div class="stack gap">
                <span><b>In your mailbox,</b> forward mail from {bank.name} to this private address:</span>
                {#if address}
                    <span class="copy-row"><code>{address}</code><Button size="sm" variant="secondary" onclick={() => copy(address, "address")}>{copied === "address" ? "Copied" : "Copy"}</Button></span>
                    <small class="muted">Keep it to yourself: anything signed by a bank and sent here is read as bank mail.</small>
                {:else}
                    <p class="note warn">{addressError || "Loading the address…"}</p>
                {/if}
            </div>
            {#if confirmation}
                <div class="panel">
                    <span>Your mailbox sent a confirmation code to this address:</span>
                    <span class="copy-row"><code class="code">{confirmation.code}</code><Button size="sm" variant="secondary" onclick={() => copy(confirmation.code, "code")}>{copied === "code" ? "Copied" : "Copy"}</Button></span>
                    <small class="muted">Paste it back in your mailbox's forwarding settings to finish turning forwarding on.</small>
                    {#if confirmationUnverified}<small class="muted">Finance could not verify who sent this message. The code is only useful in your mailbox's settings, which check it themselves.</small>{/if}
                </div>
            {/if}
            {#each unreadSince as mail (mail.id)}
                <div class="panel unread">
                    <button type="button" class="unread-head" aria-expanded={openUnreadId === mail.id} onclick={() => (openUnreadId = openUnreadId === mail.id ? null : mail.id)}>
                        <b>A message arrived that Finance could not read</b>
                        <small>{mail.subject || "No subject"} · {mail.reason.split(". ")[0]}</small>
                    </button>
                    {#if openUnreadId === mail.id}
                        <pre class="unread-text">{mail.body_text}</pre>
                        <small class="muted">{mail.reason}</small>
                    {/if}
                </div>
            {/each}
            {#if arrived}
                <div class="panel ok">First email arrived at {format(parseISO(reached?.last_sync_at ?? arrived.synced_at), "HH:mm")} · from {bank.name}, signed by the bank, layout known</div>
            {:else}
                <div class="panel waiting">Waiting for the first email from {bank.name}. Make a payment or wait for the next one; you can also close this, and the account appears by itself when it arrives.</div>
            {/if}
            <p class="note"><b>Use a filter that forwards by itself.</b> A hand-forwarded email loses the bank's signature and is refused.</p>
        {:else if step === 3 && arrived}
            <p><b>The email is about account •••• {tail}.</b></p>
            <label class="stack gap">
                <span class="over">Becomes</span>
                <select bind:value={replaceId}>
                    <option value="">A new account “{arrived.name}”</option>
                    {#each handKept as asset (asset.id)}<option value={asset.id}>Your asset “{asset.name}”, now linked</option>{/each}
                </select>
            </label>
            <div class="stack gap">
                <span class="over">Kind</span>
                <span class="segment" role="radiogroup" aria-label="Kind">
                    {#each ["current", "savings", "card"] as option (option)}
                        <label class:on={kind === option}><input type="radio" name="kind" value={option} bind:group={kind} />{option === "card" ? "Credit card" : kindLabel(option)}</label>
                    {/each}
                </span>
            </div>
            <div class="stack">
                <span class="over">Balance at the bank</span>
                <b class="figure">{formatAmount(Number(arrived.amount))} Kč</b>
                <small class="muted">{arrived.balance_source === "bank" ? `Read from the email: ${bank.name} states the balance in every one.` : "Counted from the first email; check it against the bank once."}</small>
            </div>
            {#if replacing}
                <p class="note">Available now goes from <b>{formatAmount(assetsSum)}</b> to <b>{formatAmount(assetsSum - Number(replacing.amount))} Kč</b>: “{replacing.name}” stops being counted twice.</p>
            {/if}
        {:else if step === 4}
            <p><b>Earlier months</b></p>
            <p class="muted">Emails cover what happens from now on. A statement exported from {bank.name} adds the months before; rows already there from emails are matched, not doubled.</p>
            <StatementImport {assets} {today} />
        {/if}
    </div>
    {#snippet footer()}
        {#if step > 1 && step < 4}<Button variant="secondary" size="sm" onclick={() => (step -= 1)}>Back</Button>{/if}
        {#if step === 1}
            <Button size="sm" onclick={() => (step = 2)}>Continue with {bank.name}</Button>
        {:else if step === 2 && bank.provider === "enable_banking"}
            <Button size="sm" disabled={leaving} onclick={async () => {
                leaving = true;
                try { await startBankApproval(bank.id); } catch (error) { leaving = false; notify.error(error instanceof Error ? error.message : "The bank could not be reached"); }
            }}>{leaving ? `Opening ${bank.name}…` : `Approve at ${bank.name}`}</Button>
        {:else if step === 2}
            <Button size="sm" disabled={!arrived} onclick={() => (step = 3)}>Continue</Button>
        {:else if step === 3}
            <Button size="sm" disabled={busy} onclick={link}>Link account</Button>
        {:else}
            <Button size="sm" onclick={onClose}>Finish</Button>
        {/if}
    {/snippet}
</CommandDrawer>

<style>
    .link { display: flex; flex-direction: column; gap: 14px; font-size: 14px; line-height: 20px; }
    .link p { margin: 0; }
    .options { display: flex; flex-direction: column; }
    .option { display: flex; min-height: 56px; align-items: center; gap: 12px; border-top: 1px solid var(--stor-rule); cursor: pointer; }
    .option:first-child { border-top: 0; }
    .option input { order: 3; margin-left: auto; accent-color: var(--stor-action); }
    .option.disabled { opacity: 0.55; cursor: default; }
    .stack { display: flex; min-width: 0; flex-direction: column; }
    .stack.gap { gap: 6px; }
    .stack b { font-weight: 500; }
    small, .muted { font-size: 12px; line-height: 16px; color: var(--stor-muted-text); }
    .over { font-size: 11px; font-weight: 600; letter-spacing: 0.06em; text-transform: uppercase; color: var(--stor-muted-text); }
    .note { padding: 10px 12px; border-radius: 10px; background: var(--stor-surface-muted); font-size: 12px; line-height: 18px; color: var(--stor-muted-text); }
    .note b { color: var(--stor-ink); }
    .note.warn { background: var(--stor-warning-soft); color: var(--stor-ink); }
    .copy-row { display: flex; align-items: center; gap: 8px; }
    code { flex: 1; min-width: 0; overflow: hidden; padding: 8px 10px; border-radius: 9px; background: var(--stor-surface-muted); font-family: inherit; font-weight: 500; text-overflow: ellipsis; white-space: nowrap; }
    code.code { font-size: 18px; letter-spacing: 0.08em; }
    .panel { display: flex; flex-direction: column; gap: 6px; padding: 12px; border-radius: 12px; background: var(--stor-surface-muted); font-size: 13px; }
    .panel.ok { background: var(--stor-positive-soft, var(--stor-surface-muted)); color: var(--stor-positive); font-weight: 600; }
    .panel.waiting { color: var(--stor-muted-text); }
    .panel.unread { background: var(--stor-warning-soft); }
    .unread-head { display: flex; flex-direction: column; align-items: flex-start; gap: 2px; border: 0; background: transparent; padding: 0; text-align: left; color: inherit; }
    .unread-text { max-height: 12rem; overflow: auto; margin: 0; padding: 8px; border-radius: 8px; background: var(--stor-surface); font: 12px/17px inherit; white-space: pre-wrap; }
    select { height: 38px; border: 1px solid var(--stor-field-border); border-radius: 9px; background: var(--stor-surface); color: inherit; font: inherit; }
    .segment { display: inline-flex; align-self: flex-start; padding: 3px; border-radius: 10px; background: var(--stor-surface-muted); }
    .segment label { padding: 5px 12px; border-radius: 8px; font-size: 13px; font-weight: 500; cursor: pointer; }
    .segment label.on { background: var(--stor-surface-raised); box-shadow: var(--stor-elevation-2); }
    .segment input { position: absolute; opacity: 0; pointer-events: none; }
    .figure { font-size: 20px; font-weight: 600; }
</style>
