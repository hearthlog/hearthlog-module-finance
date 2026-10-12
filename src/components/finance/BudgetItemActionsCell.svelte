<script lang="ts">
    import { CommandOnly } from "@hearthlog/sdk/ui";
    import IconPencil from "~icons/mdi/pencil-outline";
    import IconDelete from "~icons/mdi/delete-outline";

    let { name, onEdit, onDelete }: { name: string; onEdit: () => void; onDelete: () => void } = $props();
</script>

<div class="flex items-center justify-end gap-1">
    <CommandOnly>
        <button type="button" aria-label={`Edit ${name}`} class="flex h-9 w-9 items-center justify-center rounded-lg text-[var(--stor-muted-text)] transition hover:bg-[var(--stor-accent-soft)] hover:text-[var(--stor-accent-strong)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--stor-focus)]" onclick={onEdit}>
            <IconPencil class="h-4 w-4" />
        </button>
        <button type="button" aria-label={`Delete ${name}`} class="flex h-9 w-9 items-center justify-center rounded-lg text-[var(--stor-muted-text)] transition hover:bg-[var(--stor-negative-soft)] hover:text-[var(--stor-negative)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--stor-focus)]" onclick={onDelete}>
            <IconDelete class="h-4 w-4" />
        </button>
    </CommandOnly>
</div>
