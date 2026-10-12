<script lang="ts">
    let { text, tone }: { text: string; tone: "income" | "expense" } = $props();
</script>

<span class="block whitespace-nowrap text-right font-semibold tabular-nums {tone === 'income' ? 'text-[var(--stor-positive)]' : 'text-[var(--stor-ink)]'}" data-testid="budget-row-amount">{text}</span>
