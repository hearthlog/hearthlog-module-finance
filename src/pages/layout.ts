import type { ModuleLoadEvent } from '@hearthlog/sdk/runtime';
import { queryDatabase } from '@hearthlog/sdk/data';

export const load = ({ depends, parent }: ModuleLoadEvent) => {
    depends('app:assets');
    const assetsData = parent().then(async ({ workspace }) => {
        await workspace.ready;
        return queryDatabase(async (repositories) => {
            const [assets, assetsSum, connections, mails] = await Promise.all([
                repositories.assets.getAssetsByType('asset'),
                repositories.assets.getSumOfAssetsByType('asset'),
                repositories.assets.getBankConnections(),
                repositories.assets.getOpenBankMails(),
            ]);
            return { assets, assetsSum, connections, mails };
        });
    });
    void assetsData.catch(() => undefined);
    return { assetsData };
};
