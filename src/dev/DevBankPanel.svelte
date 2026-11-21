<script lang="ts">
    /** Development builds only: the fixture bank provider's controls (see bank-fixtures.ts). */
    import { notify } from "@hearthlog/sdk/runtime";
    import { applyState, convertToLinked, FIXTURE_STATES, loadFixtures, manualAssets, removeFixtures, type FixtureState } from "./bank-fixtures.js";

    let busy = $state(false);
    let state = $state<FixtureState>("current");
    let manual = $state<Array<{ id: string; name: string }>>([]);
    let convertId = $state("");

    async function act(label: string, work: () => Promise<void>): Promise<void> {
        busy = true;
        try {
            await work();
            notify.success(label);
            manual = await manualAssets();
        } catch (error) {
            console.error("[DevBank]", error);
            notify.error(error instanceof Error ? error.message : "Dev bank action failed");
        } finally {
            busy = false;
        }
    }

    const popoverId = $props.id();

    async function toggled(event: ToggleEvent): Promise<void> {
        if (event.newState === "open") manual = await manualAssets();
    }
</script>

<button type="button" class="dev-trigger" popovertarget={popoverId}>Dev bank</button>
<div class="menu" id={popoverId} popover="auto" ontoggle={toggled} role="group" aria-label="Development bank provider">
        <p class="note">Development only: fixture accounts written as ordinary local commands.</p>
        <button type="button" disabled={busy} onclick={() => act("Fixture accounts loaded", () => loadFixtures())}>Load fixture accounts</button>
        <label>
            State
            <select bind:value={state} disabled={busy}>
                {#each FIXTURE_STATES as option (option.value)}<option value={option.value}>{option.label}</option>{/each}
            </select>
        </label>
        <button type="button" disabled={busy} onclick={() => act("State applied", () => applyState(state))}>Apply state</button>
        {#if manual.length}
            <label>
                Convert a hand-kept asset
                <select bind:value={convertId} disabled={busy}>
                    <option value="">Choose…</option>
                    {#each manual as asset (asset.id)}<option value={asset.id}>{asset.name}</option>{/each}
                </select>
            </label>
            <button type="button" disabled={busy || !convertId} onclick={() => act("Linked to Air Bank", () => convertToLinked(convertId))}>Link it as Air Bank</button>
        {/if}
        <button type="button" class="danger" disabled={busy} onclick={() => act("Fixtures removed", () => removeFixtures())}>Remove fixtures</button>
</div>

<style>
    .dev-trigger {
        display: inline-flex;
        height: 30px;
        align-items: center;
        padding: 0 10px;
        border-radius: 9px;
        border: 1px dashed var(--stor-border-strong);
        background: transparent;
        outline-offset: -1px;
        font-size: 12px;
        font-weight: 600;
        color: var(--stor-muted-text);
        cursor: pointer;
    }
    .menu:popover-open {
        display: flex;
        width: 260px;
        flex-direction: column;
        gap: 8px;
        padding: 12px;
        border-radius: 12px;
        background: var(--stor-surface-raised);
        box-shadow: var(--stor-elevation-3);
        font-size: 12px;
        color: var(--stor-ink);
    }
    .note { margin: 0; color: var(--stor-muted-text); line-height: 16px; }
    label { display: flex; flex-direction: column; gap: 4px; font-weight: 600; }
    select { height: 30px; border-radius: 8px; border: 1px solid var(--stor-field-border); background: var(--stor-surface); color: inherit; font: inherit; font-weight: 400; }
    .menu { border: 0; }
    .menu button { height: 30px; border: 0; border-radius: 8px; background: var(--stor-surface-muted); font-weight: 600; color: inherit; }
    .menu button:hover:not(:disabled) { background: var(--stor-surface-hover); }
    .menu button:disabled { opacity: 0.5; }
    .danger { color: var(--stor-negative); }
</style>
