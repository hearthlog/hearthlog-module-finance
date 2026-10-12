/** The `category-pick` AI capability's item, shared by the browser request and the gateway's question. */
export interface CategoryPickItem {
    id: string;
    name: string;
    /** Absolute amount; the direction is separate. */
    amount: number;
    direction: 'income' | 'expense';
}
