import { requestDecisions, suggestionBand } from '@hearthlog/sdk/ai';
import type { CategoryPickItem } from './category-pick.js';
import { queryDatabase } from '@hearthlog/sdk/data';
import { isTransactionCategory } from './categories.js';

/**
 * Suggests a category for transactions that have none. The history rule runs
 * first, in SQL, with no model; the rest go to the decision API. A suggestion
 * is never saved here: callers fill a field or offer a chip, and the user's
 * Save or Apply is the only write.
 */

export type CategoryOrigin =
    /** Same name was given this category before: a plain reason, no AI mark. */
    | { kind: 'history'; count: number }
    /** The decision model picked it. `apply` fills the value; `offer` shows a chip. */
    | { kind: 'ai'; model: string; probability: number; band: 'apply' | 'offer' };

export interface CategorySuggestion {
    id: string;
    category: string;
    origin: CategoryOrigin;
}

/** What `transaction.category_source` stores for a suggested category. */
export function categorySource(origin: CategoryOrigin): string {
    return origin.kind === 'history' ? 'history' : `ai:${origin.model}`;
}

/** The suggestions found for the given rows, by row id. Rows without a usable suggestion are absent. */
export async function suggestCategories(rows: CategoryPickItem[]): Promise<Map<string, CategorySuggestion>> {
    return (await suggestCategoriesDetailed(rows)).suggestions;
}

/** Like {@link suggestCategories}, and says whether the model could not be asked, so a button can explain an empty result. */
export async function suggestCategoriesDetailed(
    rows: CategoryPickItem[],
): Promise<{ suggestions: Map<string, CategorySuggestion>; aiUnavailable: boolean }> {
    const suggestions = new Map<string, CategorySuggestion>();
    if (rows.length === 0) return { suggestions, aiUnavailable: false };

    const history = await queryDatabase((repositories) => repositories.transactions.categoryFromHistory(rows.map((row) => row.name)))
        .catch(() => []);
    const byName = new Map(history.map((entry) => [entry.name, entry]));
    for (const row of rows) {
        const hit = byName.get(row.name.trim());
        if (hit && isTransactionCategory(hit.category)) {
            suggestions.set(row.id, { id: row.id, category: hit.category, origin: { kind: 'history', count: hit.count } });
        }
    }

    const remaining = rows.filter((row) => !suggestions.has(row.id));
    if (remaining.length === 0) return { suggestions, aiUnavailable: false };
    const model = await requestDecisions('category-pick', remaining);
    for (const decision of model.decisions) {
        const band = suggestionBand(decision.option, decision.probability);
        if (band === 'choose' || !isTransactionCategory(decision.option) || decision.option === 'unknown') continue;
        suggestions.set(decision.id, {
            id: decision.id,
            category: decision.option,
            origin: { kind: 'ai', model: model.model, probability: decision.probability, band },
        });
    }
    return { suggestions, aiUnavailable: !model.answered };
}
