<script lang="ts">
    import { formatMoney } from "@hearthlog/sdk/format";
    import { renderComponent } from "@tanstack/svelte-table";
    import { DataTable } from "@hearthlog/sdk/table";
    import { DataTableHeader } from "@hearthlog/sdk/table";
    import { createAppColumnHelper } from "@hearthlog/sdk/table";
    import type { DataTableColumn, DataTableSorting } from "@hearthlog/sdk/table";
    import { CommandOnly } from "@hearthlog/sdk/ui";
    import type { BudgetItem } from "@hearthlog/sdk/data";
    import type { BudgetItemSort } from "../../data/budgets.js";
    import IconPlus from "~icons/mdi/plus";
    import { categoryLabel } from "../../finance/categories.js";
    import BudgetItemActionsCell from "./BudgetItemActionsCell.svelte";
    import BudgetItemAmountCell from "./BudgetItemAmountCell.svelte";
    import BudgetItemCategoryCell from "./BudgetItemCategoryCell.svelte";
    import BudgetItemNameCell from "./BudgetItemNameCell.svelte";
    import BudgetItemSelectCell from "./BudgetItemSelectCell.svelte";

    let {
        type,
        label,
        total,
        items,
        sort,
        selectedIds,
        onSelectionChange,
        onAdd,
        onEdit,
        onDelete,
        onSortChange,
    }: {
        type: "income" | "expense";
        label: string;
        total: number;
        items: BudgetItem[];
        sort: BudgetItemSort | null;
        selectedIds: Set<string>;
        onSelectionChange: (items: BudgetItem[], selected: boolean) => void;
        onAdd: () => void;
        onEdit: (item: BudgetItem) => void;
        onDelete: (item: BudgetItem) => void;
        onSortChange: (sort: BudgetItemSort | null) => void;
    } = $props();

    const moneyFormatter = { format: (value: number) => formatMoney(value) };

    /** Maps the URL sort value onto the shared table's sorting state and back. */
    function toTableSorting(value: BudgetItemSort | null): DataTableSorting {
        if (value === "name-asc") return { id: "name", desc: false };
        if (value === "name-desc") return { id: "name", desc: true };
        if (value === "amount-asc") return { id: "amount", desc: false };
        if (value === "amount-desc") return { id: "amount", desc: true };
        return { id: null, desc: false };
    }

    function fromTableSorting(sorting: DataTableSorting): BudgetItemSort | null {
        if (sorting.id !== "name" && sorting.id !== "amount") return null;
        return `${sorting.id}-${sorting.desc ? "desc" : "asc"}` as BudgetItemSort;
    }

    // Columns are built once; DataTableHeader cycles ascending, descending, then
    // clears the sort, which lands back on creation order.
    const columnHelper = createAppColumnHelper<Record<string, unknown>>();
    const columns: DataTableColumn[] = columnHelper.columns([
        columnHelper.display({
            id: "__select",
            enableSorting: false,
            header: () => renderComponent(DataTableHeader, { name: "" }),
            cell: (info) => renderComponent(BudgetItemSelectCell, {
                name: String(info.row.original.name ?? ""),
                isSelected: () => selectedIds.has(String(info.row.original.id)),
                onToggle: (selected: boolean) =>
                    onSelectionChange([info.row.original as unknown as BudgetItem], selected),
            }),
        }),
        columnHelper.accessor((row) => row.name, {
            id: "name",
            enableSorting: true,
            header: (context) => renderComponent(DataTableHeader, { name: "Name", context }),
            cell: (info) => renderComponent(BudgetItemNameCell, { name: String(info.getValue() ?? "") }),
        }),
        columnHelper.accessor((row) => row.category, {
            id: "category",
            enableSorting: false,
            header: () => renderComponent(DataTableHeader, { name: "Category" }),
            cell: (info) => renderComponent(BudgetItemCategoryCell, { category: String(info.getValue() ?? "") }),
        }),
        columnHelper.accessor((row) => row.amount, {
            id: "amount",
            enableSorting: true,
            header: (context) => renderComponent(DataTableHeader, { name: "Amount", align: "right", context }),
            cell: (info) => renderComponent(BudgetItemAmountCell, {
                text: moneyFormatter.format(Number(info.getValue() ?? 0)),
                tone: type,
            }),
        }),
        columnHelper.display({
            id: "__actions",
            enableSorting: false,
            header: () => renderComponent(DataTableHeader, { name: "Actions", align: "right" }),
            cell: (info) => renderComponent(BudgetItemActionsCell, {
                name: String(info.row.original.name ?? ""),
                onEdit: () => onEdit(info.row.original as unknown as BudgetItem),
                onDelete: () => onDelete(info.row.original as unknown as BudgetItem),
            }),
        }),
    ]);

    const sorting = $derived(toTableSorting(sort));
    const rows = $derived(items as unknown as Record<string, unknown>[]);
    const sectionSelectedCount = $derived(
        items.filter((item) => selectedIds.has(item.id)).length,
    );
    const sectionAllSelected = $derived(
        items.length > 0 && sectionSelectedCount === items.length,
    );
    const pagination = $derived({
        pageIndex: 0,
        pageSize: Math.max(items.length, 1),
        rowCount: items.length,
        pageCount: 1,
    });
</script>

<div class="budget-table border-t border-[var(--stor-border)]" data-testid={`budget-group-${type}`}>
    <div class="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 bg-[var(--stor-surface-muted)]/55 px-4 py-2.5 max-md:pl-4">
        <div class="flex items-center gap-1.5">
            <label class="flex h-9 w-9 items-center justify-center max-md:hidden">
                <input
                    type="checkbox"
                    class="h-4 w-4 rounded border-[var(--stor-field-border)] accent-[var(--stor-action)]"
                    checked={sectionAllSelected}
                    indeterminate={sectionSelectedCount > 0 && !sectionAllSelected}
                    aria-label={`Select all ${type} items`}
                    onchange={(event) => onSelectionChange(items, event.currentTarget.checked)}
                />
            </label>
            <div class="flex items-baseline gap-2">
                <h3 class="text-sm font-semibold text-[var(--stor-ink)]">{label}</h3>
                <span class="text-xs tabular-nums text-[var(--stor-muted-text)]">{moneyFormatter.format(total)}</span>
            </div>
        </div>
        <CommandOnly>
            <button class="min-h-9 text-xs font-semibold text-[var(--stor-accent-strong)]" onclick={onAdd}>
                <IconPlus class="mr-1 inline h-4 w-4" /> Add {type}
            </button>
        </CommandOnly>
    </div>
    {#snippet empty()}
        <CommandOnly>
            <button type="button" class="w-full px-4 py-6 text-center text-sm text-[var(--stor-muted-text)] hover:bg-[var(--stor-surface-muted)]" onclick={onAdd}>Add your first planned {type}.</button>
        </CommandOnly>
    {/snippet}
    <!-- Phones read the plan as a list: name and category, then the amount; a tap edits the item. -->
    <ul class="md:hidden">
        {#each items as item (item.id)}
            <li class="[&+li]:border-t [&+li]:border-[color-mix(in_srgb,var(--stor-border)_62%,transparent)]">
                <button type="button" class="flex min-h-14 w-full items-center gap-3 px-4 py-2 text-left" onclick={() => onEdit(item)}>
                    <span class="min-w-0 flex-1">
                        <span class="block truncate text-[15px] font-medium text-[var(--stor-ink)]">{item.name}</span>
                        <span class="block truncate text-[12.5px] text-[var(--stor-muted-text)]">{categoryLabel(String(item.category ?? ""))}</span>
                    </span>
                    <span class="shrink-0 text-[15px] font-semibold tabular-nums {type === 'income' ? 'text-[var(--stor-positive)]' : 'text-[var(--stor-ink)]'}">{moneyFormatter.format(Number(item.amount))}</span>
                </button>
            </li>
        {:else}
            <li>{@render empty()}</li>
        {/each}
    </ul>
    <div class="max-md:hidden"><DataTable
        {columns}
        data={rows}
        {pagination}
        {sorting}
        onSortingChange={(next) => onSortChange(fromTableSorting(next))}
        emptyContent={empty}
        testId={`budget-table-${type}`}
        scrollTestId={`budget-table-${type}-scroll`}
        rowClass={(row) => (selectedIds.has(String(row.id)) ? "bg-[var(--stor-accent-soft)]" : "")}
    /></div>
</div>

<style>
    /* Fixed column widths keep the Income and Expenses tables aligned with each
       other even though their content differs. The Name column takes the rest. */
    .budget-table :global(table) {
        table-layout: fixed;
        min-width: 30rem;
    }
    .budget-table :global(th:nth-child(1)),
    .budget-table :global(td:nth-child(1)) {
        width: 3rem;
    }
    .budget-table :global(th:nth-child(3)),
    .budget-table :global(td:nth-child(3)) {
        width: 7rem;
    }
    .budget-table :global(th:nth-child(4)),
    .budget-table :global(td:nth-child(4)) {
        width: 8.5rem;
    }
    .budget-table :global(th:nth-child(5)),
    .budget-table :global(td:nth-child(5)) {
        width: 7rem;
    }
</style>
