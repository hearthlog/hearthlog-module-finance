import type { ModuleLoadEvent } from '@hearthlog/sdk/runtime';
import { queryDatabase } from '@hearthlog/sdk/data';

export const load = ({ depends, parent }: ModuleLoadEvent) => {
    depends('app:assets');
    const assetsData = parent().then(async ({ workspace }) => {
        await workspace.ready;
        return queryDatabase(async (repositories) => {
            const [assets, assetsSum, connections] = await Promise.all([
                repositories.assets.getAssetsByType('asset'),
                repositories.assets.getSumOfAssetsByType('asset'),
                repositories.assets.getBankConnections(),
            ]);
            return { assets, assetsSum, connections };
        });
    });
    void assetsData.catch(() => undefined);
    return { assetsData };
};
