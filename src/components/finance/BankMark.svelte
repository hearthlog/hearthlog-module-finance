<script lang="ts">
    /** A neutral monogram for the bank; a dashed one for an asset kept by hand. The bank's name does the telling. */
    let { mark = "", size = "sm" }: { mark?: string; size?: "sm" | "lg" } = $props();
</script>

<span class="bank-mark {size}" class:hand={!mark} aria-hidden="true">{mark || "—"}</span>

<style>
    .bank-mark {
        display: inline-grid;
        flex: none;
        place-items: center;
        width: 22px;
        height: 22px;
        border-radius: 6px;
        background: var(--stor-surface-muted);
        box-shadow: inset 0 0 0 1px var(--stor-hairline);
        font-size: 9px;
        font-weight: 700;
        line-height: 1;
        letter-spacing: 0.02em;
        color: var(--stor-muted-text);
    }
    .lg { width: 34px; height: 34px; border-radius: 10px; font-size: 11px; }
    .hand { background: transparent; box-shadow: inset 0 0 0 1px var(--stor-border-strong); color: var(--stor-faint-text); }
</style>
