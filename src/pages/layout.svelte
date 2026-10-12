<script lang="ts">
    let { children } = $props();
</script>

<div class="h-full lg:overflow-hidden">
    {@render children()}
</div>

<style>
    :global(body) {
        overflow: hidden;
    }
</style>
