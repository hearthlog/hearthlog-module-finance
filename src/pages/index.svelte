<script lang="ts">
    import { goto } from '$app/navigation';
    import { page } from '$app/state';
    import { appClock } from '@hearthlog/sdk/runtime';
    import { DataPlaceholder } from "@hearthlog/sdk/ui";
    let { data } = $props();
    $effect(() => {
        let active = true;
        const search = page.url.search;
        void data.workspace.ready.then(() => {
            if (!active) return;
            const now = appClock.now();
            return goto(`/finance/${now.getFullYear()}/${now.getMonth() + 1}${search}`, { replace: true });
        }).catch(() => undefined);
        return () => { active = false; };
    });
</script>
<svelte:head><title>Finance</title></svelte:head>
<div class="p-4"><h1 class="text-2xl font-semibold">Finance</h1><DataPlaceholder label="Opening the selected month" /></div>
