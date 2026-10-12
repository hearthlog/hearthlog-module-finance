<script lang="ts">
    import { Drawer } from "@hearthlog/sdk/ui";
    import { Button } from "@hearthlog/sdk/ui";
    import { Input } from "@hearthlog/sdk/ui";
    import { Label } from "@hearthlog/sdk/ui";
    import { tick } from "svelte";
    import { ChoiceChips } from "@hearthlog/sdk/ui";

    let {
        show,
        title,
        description,
        actionLabel,
        initialName,
        onClose,
        onSave,
        startFrom,
    }: {
        show: boolean;
        title: string;
        description: string;
        actionLabel: string;
        initialName: string;
        onClose: () => void;
        onSave: (name: string, copy: boolean) => Promise<void>;
        /** Phones: a new plan can start from the current one (`detail` says what it copies). */
        startFrom?: { label: string; detail: string };
    } = $props();

    let copy = $state(true);

    let name = $state("");
    let saving = $state(false);
    let errorMessage = $state("");
    let loadedKey = "";

    $effect(() => {
        const key = `${show}:${title}:${initialName}`;
        // Closing forgets the loaded plan, so the next new plan starts clean.
        if (!show) loadedKey = "";
        if (!show || key === loadedKey) return;
        loadedKey = key;
        name = initialName;
        copy = true;
        errorMessage = "";
        void tick().then(() => document.querySelector<HTMLInputElement>('[data-testid="budget-plan-name"]')?.focus());
    });

    async function submit(event: SubmitEvent) {
        event.preventDefault();
        if (saving) return;
        if (!name.trim()) {
            errorMessage = "Enter a plan name.";
            return;
        }
        saving = true;
        errorMessage = "";
        try {
            await onSave(name.trim(), !!startFrom && copy);
        } catch (error) {
            errorMessage = error instanceof Error ? error.message : "The plan could not be saved.";
        } finally {
            saving = false;
        }
    }
</script>

<Drawer {show} {title} {description} {onClose}>
    <form id="budget-plan-form" class="space-y-4" onsubmit={submit}>
        <Label class="block">
            Plan name
            <Input data-testid="budget-plan-name" class="mt-1.5" bind:value={name} placeholder="Baseline, Save more…" />
        </Label>
        {#if startFrom}
            <div class="flex flex-col gap-1.5">
                <span class="text-sm font-medium text-[var(--stor-ink)]">Start from</span>
                <ChoiceChips label="Start from" options={[{ value: "copy", label: startFrom.label }, { value: "empty", label: "Empty" }]} value={copy ? "copy" : "empty"} onChange={(value) => (copy = value === "copy")} />
                {#if copy}<p class="text-xs text-[var(--stor-muted-text)]">{startFrom.detail}</p>{/if}
            </div>
        {/if}
        {#if errorMessage}<p class="text-sm text-[var(--stor-negative)]" role="alert">{errorMessage}</p>{/if}
    </form>
    {#snippet footer()}
        <Button variant="secondary" onclick={onClose} disabled={saving}>Cancel</Button>
        <Button type="submit" form="budget-plan-form" disabled={saving} data-testid="save-budget-plan">
            {saving ? "Saving…" : actionLabel}
        </Button>
    {/snippet}
</Drawer>
