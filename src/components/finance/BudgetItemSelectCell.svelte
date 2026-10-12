<script lang="ts">
    // The checkbox reads selection state through a getter so the cell updates
    // even when the table renderer captured its props once.
    let {
        name,
        isSelected,
        onToggle,
    }: {
        name: string;
        isSelected: () => boolean;
        onToggle: (selected: boolean) => void;
    } = $props();

    const selected = $derived(isSelected());
</script>

<label class="flex h-11 w-11 items-center justify-center">
    <input
        type="checkbox"
        class="h-4 w-4 rounded border-[var(--stor-field-border)] accent-[var(--stor-action)]"
        checked={selected}
        aria-label={`Select ${name}`}
        onchange={(event) => onToggle(event.currentTarget.checked)}
    />
</label>
