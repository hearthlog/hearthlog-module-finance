<script lang="ts">
    let { name }: { name: string } = $props();
</script>

<span class="block max-w-[28rem] truncate font-medium text-[var(--stor-ink)]" data-testid="budget-row-name">{name}</span>
