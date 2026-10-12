import type { Asset } from '@hearthlog/sdk/data';
import type { ReadModelSession } from '@hearthlog/sdk/data';
import { withTimeout } from '@hearthlog/sdk/data';

export type { Asset };

const DB_TIMEOUT_MS = 5000;

export function createAssetRepository(session: ReadModelSession) {
    return {
        getAssets(): Promise<Asset[]> {
            return withTimeout(
                session.selectFrom('assets')
                    .selectAll()
                    .orderBy('created_at', 'asc')
                    .orderBy('id', 'asc')
                    .execute(),
                DB_TIMEOUT_MS,
                'getAssets query timed out',
            );
        },

        async getSumOfAssetsByType(category: string): Promise<number> {
            const result = await withTimeout(
                session.selectFrom('assets')
                    .select(({ fn }) => fn.sum('amount').as('sum'))
                    .where('asset_type', '=', category)
                    .executeTakeFirst(),
                DB_TIMEOUT_MS,
                'getSumOfAssetsByType query timed out',
            );
            return Number(result?.sum ?? 0);
        },

        getAssetsByType(assetType: string): Promise<Asset[]> {
            return withTimeout(
                session.selectFrom('assets')
                    .selectAll()
                    .where('asset_type', '=', assetType)
                    .orderBy('created_at', 'asc')
                    .orderBy('id', 'asc')
                    .execute(),
                DB_TIMEOUT_MS,
                'getAssetsByType query timed out',
            );
        },
    };
}
