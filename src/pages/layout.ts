import type { ModuleLoadEvent } from '@hearthlog/sdk/runtime';
import { queryDatabase } from '@hearthlog/sdk/data';

export const load = ({ depends, parent }: ModuleLoadEvent) => {
    depends('app:assets');
    const assetsData = parent().then(async ({ workspace }) => {
        await workspace.ready;
        return queryDatabase(async (repositories) => {
            const [assets, assetsSum] = await Promise.all([
                repositories.assets.getAssetsByType('asset'),
                repositories.assets.getSumOfAssetsByType('asset'),
            ]);
            return { assets, assetsSum };
        });
    });
    void assetsData.catch(() => undefined);
    return { assetsData };
};
