<script lang="ts">
    const drawerId = $props.id();
    const drawerFormId0 = drawerId + "-0";

    import { tick } from "svelte";
    import type { Asset } from "../../data/assets.js";
    import { CommandDrawer } from "@hearthlog/sdk/ui";
    import { Button } from "@hearthlog/sdk/ui";
    import { Input } from "@hearthlog/sdk/ui";
    import { Label } from "@hearthlog/sdk/ui";

    let {
        show,
        asset = null,
        onClose,
        onSave,
    }: {
        show: boolean;
        asset?: Asset | null;
        onClose: () => void;
        onSave: (draft: { name: string; amount: number }) => Promise<void>;
    } = $props();

    let name = $state("");
    let amount = $state(0);
    let saving = $state(false);
    let errorMessage = $state("");
    let loadedKey = "";

    $effect(() => {
        if (!show) {
            loadedKey = "";
            return;
        }
        const key = `${show}:${asset?.id ?? "new"}`;
        if (key === loadedKey) return;
        loadedKey = key;
        name = asset?.name ?? "";
        amount = asset?.amount ?? 0;
        errorMessage = "";
    });

    $effect(() => {
        if (!show) return;
        let focusFrame = 0;
        void tick().then(() => {
            focusFrame = requestAnimationFrame(() => {
                document.querySelector<HTMLInputElement>(
                    '[data-testid="asset-name"]',
                )?.focus();
            });
        });
        return () => cancelAnimationFrame(focusFrame);
    });

    async function submit(event: SubmitEvent) {
        event.preventDefault();
        if (saving) return;
        if (!name.trim()) {
            errorMessage = "Enter an asset name.";
            return;
        }
        if (!Number.isFinite(Number(amount)) || Number(amount) <= 0) {
            errorMessage = "Enter a balance greater than zero.";
            return;
        }

        saving = true;
        errorMessage = "";
        try {
            await onSave({ name: name.trim(), amount: Number(amount) });
        } catch (error) {
            errorMessage =
                error instanceof Error
                    ? error.message
                    : "The asset could not be saved.";
        } finally {
            saving = false;
        }
    }
</script>

<CommandDrawer
    {show}
    title={asset ? "Edit asset" : "Add asset"}
    description={asset
        ? "Update the name or current balance."
        : "Add an account or balance to your financial overview."}
    {onClose}
>
    <form id={drawerFormId0} class="space-y-4" onsubmit={submit}>
        <Label class="block">
            Asset name
            <Input
                autofocus
                data-testid="asset-name"
                bind:value={name}
                placeholder="Savings account"
                class="mt-1.5"
            />
        </Label>

        <Label class="block">
            Balance
            <div class="relative mt-1.5">
                <Input
                    type="number"
                    min="0.01"
                    step="0.01"
                    bind:value={amount}
                    class="pr-12 font-medium"
                />
                <span class="pointer-events-none absolute inset-y-0 right-4 flex items-center text-sm text-[var(--stor-muted-text)]">Kč</span>
            </div>
        </Label>

        {#if errorMessage}
            <div class="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">
                {errorMessage}
            </div>
        {/if}

        </form>
    {#snippet footer()}
            <Button variant="secondary" size="sm" onclick={onClose} disabled={saving}>
                Cancel
            </Button>
            <Button type="submit" form={drawerFormId0} disabled={saving}>
                {saving ? "Saving..." : asset ? "Save changes" : "Add asset"}
            </Button>

    {/snippet}
</CommandDrawer>
