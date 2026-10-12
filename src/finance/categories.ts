/** The fixed transaction categories, in the order forms list them. */
export const TRANSACTION_CATEGORIES = [
    { value: 'unknown', label: 'Uncategorized' },
    { value: 'income', label: 'Income' },
    { value: 'housing', label: 'Housing' },
    { value: 'food', label: 'Food' },
    { value: 'transport', label: 'Transport' },
    { value: 'subscriptions', label: 'Subscriptions' },
    { value: 'health', label: 'Health' },
    { value: 'shopping', label: 'Shopping' },
    { value: 'leisure', label: 'Leisure' },
    { value: 'kids', label: 'Kids' },
    { value: 'gifts', label: 'Gifts and giving' },
    { value: 'other', label: 'Other' },
] as const;

export type TransactionCategory = (typeof TRANSACTION_CATEGORIES)[number]['value'];

const LABELS: Record<string, string> = Object.fromEntries(
    TRANSACTION_CATEGORIES.map((category) => [category.value, category.label]),
);

export function categoryLabel(value: string | null | undefined): string {
    return LABELS[value ?? ''] ?? 'Uncategorized';
}

export function isTransactionCategory(value: unknown): value is TransactionCategory {
    return typeof value === 'string' && value in LABELS;
}
