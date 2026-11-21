<script lang="ts">
    import { format, parseISO, subDays } from "date-fns";
    import { formatAmount } from "@hearthlog/sdk/format";
    import { queryDatabase, type Transaction } from "@hearthlog/sdk/data";
    import { notify } from "@hearthlog/sdk/runtime";
    import { Button, CommandDrawer, CommandOnly } from "@hearthlog/sdk/ui";
    import type { Asset, BankConnection } from "../../data/assets.js";
    import { bankInfo } from "../../finance/banks.js";
    import { categoryLabel, TRANSACTION_CATEGORIES } from "../../finance/categories.js";
    import { categorySource, suggestCategoriesDetailed, type CategorySuggestion } from "../../finance/category-suggestions.js";
    import { NO_MATCH, scorePlan, suggestTransfers, type TransferSuggestion } from "../../finance/matching.js";
    import { toMatchPlan, toMatchRow } from "../../finance/matching-pass.js";
    import { acceptRows, confirmPlan, confirmTransfer, declinePlan, run, splitTransfer, transferIdFor, type Decision } from "../../finance/review-commands.js";
    import BankMark from "./BankMark.svelte";
    import IconCheck from "~icons/mdi/check";
    import IconArrow from "~icons/mdi/arrow-right";
    import IconSwap from "~icons/mdi/swap-horizontal";

    /**
     * The review inbox: plans a bank row looks like it paid, moves between the user's own accounts, and the plain new
     * rows with a suggested category and one bulk accept. The balance is already right; reviewing only decides names,
     * categories and which plans are settled. Every decision has an Undo.
     */
    let { show, assets, connections, onClose }: { show: boolean; assets: Asset[]; connections: BankConnection[]; onClose: () => void } = $props();

    interface PlanPair { row: Transaction; plan: Transaction; why: string }

    let rows = $state<Transaction[]>([]);
    let pairs = $state<PlanPair[]>([]);
    let transfers = $state<TransferSuggestion[]>([]);
    let suggestions = $state<Map<string, CategorySuggestion>>(new Map());
    let picked = $state<Record<string, string>>({});
    let loading = $state(false);
    let busy = $state(false);
    let candidates = $state<Map<string, Transaction>>(new Map());

    const accountOf = (assetId: string) => assets.find((asset) => asset.id === assetId) ?? null;
    const markOf = (asset: Asset | null) => bankInfo(connections.find((connection) => connection.id === asset?.connection_id)?.bank)?.mark ?? "";
    const day = (value: string) => format(parseISO(value.slice(0, 10)), "EEE d MMM");
    const inGroups = $derived(new Set([...pairs.map((pair) => pair.row.id), ...transfers.flatMap((t) => (t.kind === "pair" ? [t.from.id, t.to.id] : [t.from.id]))]));
    const plain = $derived(rows.filter((row) => !inGroups.has(row.id)));
    const categoryFor = (row: Transaction) => picked[row.id] ?? (row.transaction_category && row.transaction_category !== "unknown" ? row.transaction_category : suggestions.get(row.id)?.category ?? "unknown");
    const sourceFor = (row: Transaction) => {
        if (picked[row.id]) return { label: "picked by you", value: "manual" };
        if (row.transaction_category && row.transaction_category !== "unknown") {
            const source = row.category_source || "manual";
            return { label: source.startsWith("ai:") ? "AI" : source === "history" ? "history" : "set before", value: source };
        }
        const suggestion = suggestions.get(row.id);
        if (!suggestion) return { label: "no confident pick", value: "" };
        return { label: suggestion.origin.kind === "history" ? "history" : "AI", value: categorySource(suggestion.origin) };
    };
    const ready = $derived(plain.filter((row) => categoryFor(row) !== "unknown"));
    const total = $derived(pairs.length + transfers.length + plain.length);

    async function load(): Promise<void> {
        loading = true;
        try {
            const review = await queryDatabase((repositories) => repositories.transactions.getReviewRows());
            const planIds = [...new Set(review.map((row) => row.plan_match).filter((id) => id && id !== NO_MATCH))];
            const oldest = review[0]?.due_date.slice(0, 10) ?? format(new Date(), "yyyy-MM-dd");
            const since = format(subDays(parseISO(oldest), 3), "yyyy-MM-dd");
            const [plans, pool] = await queryDatabase((repositories) => Promise.all([
                repositories.transactions.getByIds(planIds),
                repositories.transactions.getTransferCandidates(since),
            ]));
            const planById = new Map(plans.map((plan) => [plan.id, plan]));
            pairs = review.flatMap((row) => {
                const plan = planById.get(row.plan_match);
                if (!plan) return [];
                return [{ row, plan, why: scorePlan(toMatchRow(row), toMatchPlan(plan), false)?.why ?? "Close in amount and day" }];
            });
            const matched = new Set(pairs.map((pair) => pair.row.id));
            const reviewIds = new Set(review.map((row) => row.id));
            const accounts = assets.map((asset) => ({ id: asset.id, name: asset.name, accountKey: asset.link === "bank" ? asset.account_hash : "" }));
            candidates = new Map(pool.map((row) => [row.id, row]));
            transfers = suggestTransfers(pool.filter((row) => !matched.has(row.id)).map(toMatchRow), accounts)
                .filter((suggestion) => reviewIds.has(suggestion.from.id) || (suggestion.kind === "pair" && reviewIds.has(suggestion.to.id)));
            rows = review;
            const unknown = review.filter((row) => !matched.has(row.id) && (!row.transaction_category || row.transaction_category === "unknown"));
            const missing = unknown.filter((row) => !suggestions.has(row.id));
            if (missing.length) {
                const { suggestions: found } = await suggestCategoriesDetailed(missing.map((row) => ({
                    id: row.id,
                    name: row.bank_text || row.name || "",
                    amount: Math.abs(Number(row.amount)),
                    direction: Number(row.amount) >= 0 ? "income" : "expense",
                })));
                suggestions = new Map([...suggestions, ...found]);
            }
        } catch (error) {
            console.error("[Review]", error);
            notify.error("The review could not be loaded");
        } finally {
            loading = false;
        }
    }

    $effect(() => {
        if (show) void load();
    });

    async function decide(decision: Decision, message: string): Promise<void> {
        busy = true;
        try {
            await run(decision.events);
            notify.success(message, {
                label: "Undo",
                run: () => run(decision.undo).then(load).catch(() => notify.error("Could not undo")),
            });
            await load();
        } catch (error) {
            console.error("[Review]", error);
            notify.error("The change could not be saved");
        } finally {
            busy = false;
        }
    }

    const confirmPair = (pair: PlanPair) => decide(confirmPlan(pair.row, pair.plan), `${pair.plan.name || "The plan"} is settled by the payment of ${day(pair.row.due_date)}`);
    const declinePair = (pair: PlanPair) => decide(declinePlan(pair.row), `Kept apart: ${pair.plan.name || "the plan"} counts in the forecast again`);

    async function joinTransfer(suggestion: TransferSuggestion): Promise<void> {
        const from = candidates.get(suggestion.from.id);
        if (!from) return;
        const sides = suggestion.kind === "pair" ? [from, candidates.get(suggestion.to.id)!].filter(Boolean) : [from];
        const handKept = suggestion.kind === "cash" ? accountOf(suggestion.toAssetId) : null;
        const transferId = await transferIdFor(...sides.map((side) => side.id));
        await decide(
            confirmTransfer(sides, transferId, handKept ? { id: handKept.id, amount: Number(handKept.amount), add: suggestion.amount } : undefined),
            handKept ? `Moved to ${handKept.name}: its balance is ${formatAmount(Number(handKept.amount) + suggestion.amount)} Kč now` : "Marked as a transfer between your accounts",
        );
    }

    async function separate(suggestion: TransferSuggestion): Promise<void> {
        const sides = [candidates.get(suggestion.from.id), suggestion.kind === "pair" ? candidates.get(suggestion.to.id) : undefined].filter((row): row is Transaction => !!row);
        await decide(splitTransfer(sides), "Kept as separate rows");
    }

    const accept = (list: Transaction[]) => decide(
        acceptRows(list.map((row) => ({ row, category: categoryFor(row), source: sourceFor(row).value || "manual" }))),
        list.length === 1 ? `${list[0]!.name || "Row"} reviewed` : `${list.length} rows reviewed`,
    );
</script>

<CommandDrawer {show} size="lg" title={`To review ${loading && !rows.length ? "" : total}`} description="The balance is already right. Reviewing only decides names, categories and which plans are settled." {onClose}>
    <div class="review">
        <section class="group" aria-label="Looks like a plan">
            <div class="group-head"><h3>Looks like a plan</h3><span>Nothing is linked until you say so</span></div>
            {#each pairs as pair (pair.row.id)}
                {@const account = accountOf(pair.row.asset_id)}
                <div class="card">
                    <div class="pair">
                        <div class="side">
                            <span class="k">Your plan</span>
                            <span class="v">{pair.plan.name || "Plan"}</span>
                            <span class="m">{day(pair.plan.due_date)} · {categoryLabel(pair.plan.transaction_category)}</span>
                            <span class="big">{formatAmount(Number(pair.plan.amount), { signed: true })} Kč</span>
                        </div>
                        <span class="mid" aria-hidden="true"><IconSwap class="h-5 w-5" /></span>
                        <div class="side divided">
                            <span class="k">From the bank</span>
                            <span class="v">{pair.row.bank_text || pair.row.name}</span>
                            <span class="m"><BankMark mark={markOf(account)} />{day(pair.row.due_date)} · {account?.name ?? "Account"}</span>
                            <span class="big">{formatAmount(Number(pair.row.amount), { signed: true })} Kč</span>
                        </div>
                    </div>
                    <div class="foot">
                        <span class="why">{pair.why}</span>
                        <CommandOnly>
                            <span class="actions">
                                <Button size="sm" variant="secondary" disabled={busy} onclick={() => declinePair(pair)}>Not this one</Button>
                                <Button size="sm" disabled={busy} onclick={() => confirmPair(pair)}>Confirm, plan is paid</Button>
                            </span>
                        </CommandOnly>
                    </div>
                </div>
            {:else}
                <p class="empty"><IconCheck class="h-4 w-4" />No plan waits for a decision.</p>
            {/each}
        </section>

        <section class="group" aria-label="Between your accounts">
            <div class="group-head"><h3>Between your accounts</h3><span>Transfers stay out of income and expenses</span></div>
            {#each transfers as suggestion (suggestion.from.id)}
                {@const fromAccount = accountOf(suggestion.from.assetId)}
                {@const toAccount = accountOf(suggestion.kind === "pair" ? suggestion.to.assetId : suggestion.toAssetId)}
                <div class="card">
                    <div class="pair">
                        <div class="side">
                            <span class="k">Left</span>
                            <span class="v">{fromAccount?.name ?? "Account"}</span>
                            <span class="m">{day(suggestion.from.date)} · {suggestion.from.bankText || suggestion.from.name}</span>
                            <span class="big">−{formatAmount(suggestion.amount)} Kč</span>
                        </div>
                        <span class="mid" aria-hidden="true"><IconArrow class="h-5 w-5" /></span>
                        <div class="side divided">
                            <span class="k">{suggestion.kind === "pair" ? "Arrived" : suggestion.kind === "cash" ? "Lands in" : "Goes to"}</span>
                            <span class="v">{toAccount?.name ?? "Account"}</span>
                            <span class="m">{suggestion.kind === "pair" ? `${day(suggestion.to.date)} · linked account` : suggestion.kind === "cash" ? `By hand · would rise from ${formatAmount(Number(toAccount?.amount ?? 0))} to ${formatAmount(Number(toAccount?.amount ?? 0) + suggestion.amount)} Kč` : "Its side has not arrived yet"}</span>
                            <span class="big positive">+{formatAmount(suggestion.amount)} Kč</span>
                        </div>
                    </div>
                    <div class="foot">
                        <span class="why">{suggestion.why}</span>
                        <CommandOnly>
                            <span class="actions">
                                <Button size="sm" variant="secondary" disabled={busy} onclick={() => separate(suggestion)}>Two separate rows</Button>
                                <Button size="sm" disabled={busy} onclick={() => joinTransfer(suggestion)}>It is a transfer</Button>
                            </span>
                        </CommandOnly>
                    </div>
                </div>
            {:else}
                <p class="empty"><IconCheck class="h-4 w-4" />No transfers waiting.</p>
            {/each}
        </section>

        <section class="group" aria-label="New from the bank">
            <div class="group-head">
                <h3>New from the bank</h3>
                {#if ready.length > 1}
                    <CommandOnly><Button size="sm" disabled={busy} onclick={() => accept(ready)}>Accept {ready.length} as suggested</Button></CommandOnly>
                {/if}
            </div>
            {#if plain.length}
                <div class="card">
                    {#each plain as row (row.id)}
                        {@const account = accountOf(row.asset_id)}
                        {@const category = categoryFor(row)}
                        <div class="new-row">
                            <span class="d2">{format(parseISO(row.due_date.slice(0, 10)), "EEE d")}</span>
                            <span class="stack"><span class="name">{row.name || row.bank_text}</span><small>{account?.name ?? "Account"} · {sourceFor(row).label}</small></span>
                            <select class="pick" class:ask={category === "unknown"} aria-label={`Category for ${row.name}`} value={category} onchange={(event) => (picked = { ...picked, [row.id]: event.currentTarget.value })}>
                                {#each TRANSACTION_CATEGORIES as option (option.value)}<option value={option.value}>{option.value === "unknown" ? "Pick a category" : option.label}</option>{/each}
                            </select>
                            <span class="amount" class:positive={Number(row.amount) > 0}>{formatAmount(Number(row.amount), { signed: Number(row.amount) > 0 })}</span>
                            <CommandOnly>
                                <button type="button" class="ok" aria-label={`Accept ${row.name}`} disabled={busy || category === "unknown"} onclick={() => accept([row])}><IconCheck class="h-5 w-5" /></button>
                            </CommandOnly>
                        </div>
                    {/each}
                </div>
            {:else if !loading}
                <p class="empty"><IconCheck class="h-4 w-4" />Everything from the bank is reviewed.</p>
            {/if}
            <p class="note"><b>Where a suggestion comes from.</b> “History” means you filed this name the same way before. “AI” is the category pick Finance already uses, given the merchant name as the bank wrote it. A row with no confident pick asks instead of guessing.</p>
        </section>
    </div>
</CommandDrawer>

<style>
    .review { display: flex; flex-direction: column; gap: 22px; }
    .group { display: flex; flex-direction: column; gap: 10px; }
    .group-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; min-height: 32px; }
    .group-head h3 { margin: 0; font-size: 15px; line-height: 22px; font-weight: 600; }
    .group-head span { font-size: 12px; color: var(--stor-muted-text); }
    .card { display: flex; flex-direction: column; overflow: hidden; border: 1px solid var(--stor-hairline); border-radius: 14px; background: var(--stor-surface); box-shadow: var(--stor-elevation-1); }
    .pair { display: grid; grid-template-columns: minmax(0, 1fr) 28px minmax(0, 1fr); }
    .side { display: flex; min-width: 0; flex-direction: column; gap: 2px; padding: 14px 16px; }
    .side.divided { border-left: 1px solid var(--stor-rule); }
    .mid { display: grid; place-items: center; color: var(--stor-faint-text); }
    .k { font-size: 11px; font-weight: 600; letter-spacing: 0.06em; text-transform: uppercase; color: var(--stor-muted-text); }
    .v { overflow: hidden; font-size: 14px; font-weight: 500; text-overflow: ellipsis; white-space: nowrap; }
    .m { display: flex; align-items: center; gap: 6px; overflow: hidden; font-size: 12px; color: var(--stor-muted-text); white-space: nowrap; }
    .big { font-size: 17px; font-weight: 600; letter-spacing: -0.015em; font-variant-numeric: tabular-nums; }
    .positive { color: var(--stor-positive); }
    .foot { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 8px 12px; padding: 10px 12px 10px 16px; border-top: 1px solid var(--stor-rule); background: var(--stor-surface-muted); }
    .why { flex: 1 1 14rem; font-size: 12px; line-height: 16px; color: var(--stor-muted-text); }
    .actions { display: flex; gap: 6px; }
    .new-row { display: grid; grid-template-columns: 56px minmax(0, 1fr) 150px 96px 40px; align-items: center; min-height: 52px; border-top: 1px solid var(--stor-rule); }
    .new-row:first-child { border-top: 0; }
    .new-row > * { min-width: 0; padding: 0 8px; }
    .d2 { padding-left: 16px !important; font-size: 12px; color: var(--stor-muted-text); white-space: nowrap; }
    .stack { display: flex; flex-direction: column; }
    .name { overflow: hidden; font-weight: 500; text-overflow: ellipsis; white-space: nowrap; }
    small { overflow: hidden; font-size: 12px; color: var(--stor-faint-text); text-overflow: ellipsis; white-space: nowrap; }
    .pick { height: 30px; border: 0; border-radius: 9px; background: var(--stor-surface-raised); box-shadow: var(--stor-elevation-2); font: inherit; font-size: 12px; font-weight: 500; color: var(--stor-ink); }
    .pick.ask { box-shadow: inset 0 0 0 1.5px var(--stor-warning); color: var(--stor-warning); font-weight: 600; }
    .amount { text-align: right; font-weight: 600; white-space: nowrap; font-variant-numeric: tabular-nums; }
    .ok { display: inline-grid; width: 30px; height: 30px; place-items: center; border: 0; border-radius: 9px; background: transparent; color: var(--stor-accent-text); }
    .ok:hover:not(:disabled) { background: var(--stor-accent-soft); }
    .ok:disabled { opacity: 0.35; }
    .empty { display: flex; align-items: center; gap: 10px; margin: 0; padding: 14px 16px; border: 1px dashed var(--stor-border-strong); border-radius: 14px; font-size: 13px; color: var(--stor-muted-text); }
    .note { margin: 0; padding: 10px 12px; border-radius: 10px; background: var(--stor-surface-muted); font-size: 12px; line-height: 18px; color: var(--stor-muted-text); }
    .note b { color: var(--stor-ink); }
    @media (max-width: 639px) {
        .pair { grid-template-columns: minmax(0, 1fr); }
        .mid { display: none; }
        .side.divided { border-left: 0; border-top: 1px solid var(--stor-rule); }
        .new-row { grid-template-columns: minmax(0, 1fr) 110px 80px 36px; }
        .d2 { display: none; }
    }
</style>
