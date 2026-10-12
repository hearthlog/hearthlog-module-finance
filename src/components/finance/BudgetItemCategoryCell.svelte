<script lang="ts">
    let { category }: { category: string } = $props();

    const label = $derived(category ? `${category.charAt(0).toUpperCase()}${category.slice(1).replaceAll("-", " ")}` : "Other");
</script>

<span class="text-xs text-[var(--stor-muted-text)]">{label}</span>
