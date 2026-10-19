<script lang="ts">
    import { Drawer } from "@hearthlog/sdk/ui";
    import { AmountField, Button, Field } from "@hearthlog/sdk/ui";
    import { Input } from "@hearthlog/sdk/ui";
    import { Label } from "@hearthlog/sdk/ui";
    import { Select, type SelectOption } from "@hearthlog/sdk/ui";
    import type { BudgetItem } from "@hearthlog/sdk/data";
    import { tick } from "svelte";

    export interface BudgetItemDraft {
        id?: string;
        name: string;
        amount: number;
        itemType: "income" | "expense";
        category: string;
    }

    let { show, planName, initialItem, initialType, onClose, onSave } = $props<{
        show: boolean;
        planName: string;
        initialItem: BudgetItem | null;
        initialType: "income" | "expense";
        onClose: () => void;
        onSave: (draft: BudgetItemDraft, addAnother: boolean) => Promise<void>;
    }>();

    const categories: SelectOption[] = [
        { value: "income", label: "Income" },
        { value: "housing", label: "Housing" },
        { value: "food", label: "Food" },
        { value: "transport", label: "Transport" },
        { value: "subscriptions", label: "Subscriptions" },
        { value: "health", label: "Health" },
        { value: "savings", label: "Savings" },
        { value: "other", label: "Other" },
    ];
    let form = $state<BudgetItemDraft>({ name: "", amount: 0, itemType: "expense", category: "other" });
    let addAnother = $state(false);
    let saving = $state(false);
    let errorMessage = $state("");
    let loadedKey = "";

    $effect(() => {
        const key = `${show}:${initialItem?.id ?? "new"}:${initialType}`;
        // Closing forgets the loaded item, so the next new item starts clean.
        if (!show) loadedKey = "";
        if (!show || key === loadedKey) return;
        loadedKey = key;
        form = initialItem ? {
            id: initialItem.id,
            name: initialItem.name,
            amount: initialItem.amount,
            itemType: initialItem.item_type as "income" | "expense",
            category: initialItem.category,
        } : { name: "", amount: 0, itemType: initialType, category: initialType === "income" ? "income" : "other" };
        addAnother = false;
        errorMessage = "";
        let firstFrame = 0;
        let secondFrame = 0;
        void tick().then(() => {
            firstFrame = requestAnimationFrame(() => {
                secondFrame = requestAnimationFrame(() => {
                    document.querySelector<HTMLInputElement>('[data-testid="budget-item-name"]')?.focus();
                });
            });
        });
        return () => {
            cancelAnimationFrame(firstFrame);
            cancelAnimationFrame(secondFrame);
        };
    });

    async function submit(event: SubmitEvent) {
        event.preventDefault();
        if (saving) return;
        const amount = Number(form.amount);
        if (!form.name.trim()) { errorMessage = "Enter an item name."; return; }
        if (!Number.isFinite(amount) || amount <= 0) { errorMessage = "Enter an amount greater than zero."; return; }
        saving = true;
        errorMessage = "";
        try {
            await onSave({ ...form, name: form.name.trim(), amount }, addAnother && !form.id);
            if (addAnother && !form.id) {
                form = { ...form, name: "", amount: 0 };
                loadedKey = "";
                await tick();
                document.querySelector<HTMLInputElement>('[data-testid="budget-item-name"]')?.focus();
            }
        } catch (error) {
            errorMessage = error instanceof Error ? error.message : "The item could not be saved.";
        } finally {
            saving = false;
        }
    }
</script>

<Drawer show={show} title={initialItem ? "Edit planned item" : "Add planned item"} description={planName} onClose={onClose}>
    <form id="budget-item-form" class="space-y-4" onsubmit={submit}>
        <fieldset>
            <legend class="mb-1.5 text-sm font-medium text-stone-800">Type</legend>
            <div class="grid grid-cols-2 rounded-xl bg-[var(--stor-surface-muted)] p-1">
                <button type="button" class="h-10 rounded-lg text-sm font-semibold transition {form.itemType === 'expense' ? 'bg-[var(--stor-selected)] text-[var(--stor-accent-strong)] shadow-sm' : 'text-[var(--stor-muted-text)]'}" onclick={() => { form.itemType = 'expense'; if (form.category === 'income') form.category = 'other'; }}>Expense</button>
                <button type="button" class="h-10 rounded-lg text-sm font-semibold transition {form.itemType === 'income' ? 'bg-[var(--stor-selected)] text-[var(--stor-accent-strong)] shadow-sm' : 'text-[var(--stor-muted-text)]'}" onclick={() => { form.itemType = 'income'; form.category = 'income'; }}>Income</button>
            </div>
        </fieldset>
        <Label class="block">Name<Input data-testid="budget-item-name" class="mt-1.5" bind:value={form.name} placeholder="Rent, salary, groceries…" /></Label>
        <Field label="Amount" htmlFor="budget-item-amount" hintClass="max-md:hidden" hint="Always enter a positive amount.">
            <AmountField id="budget-item-amount" data-testid="budget-item-amount" directions={false} bind:value={() => form.amount || null, (value) => (form.amount = value ?? 0)} />
        </Field>
        <Label class="block">Category<Select class="mt-1.5" value={form.category} options={categories} onValueChange={(value) => form.category = value} /></Label>
        {#if !initialItem}<label class="flex min-h-11 items-center gap-2 text-sm text-stone-700"><input type="checkbox" bind:checked={addAnother} class="h-4 w-4 rounded accent-[var(--stor-action)]" /> Add another after saving</label>{/if}
        {#if errorMessage}<p class="text-sm text-[var(--stor-negative)]" role="alert">{errorMessage}</p>{/if}
    </form>
    {#snippet footer()}
        <Button variant="secondary" onclick={onClose} disabled={saving}>Cancel</Button>
        <Button type="submit" form="budget-item-form" disabled={saving} data-testid="save-budget-item">{saving ? "Saving…" : initialItem ? "Save changes" : form.itemType === "income" ? "Add income" : "Add expense"}</Button>
    {/snippet}
</Drawer>
