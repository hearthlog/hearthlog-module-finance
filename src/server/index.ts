import type { ServerModule } from '@hearthlog/sdk/server';
import { categoryPick } from './category-pick.js';

/** Finance's part of the gateway Worker: the AI decision that suggests a transaction's category. */
const finance: ServerModule<Env> = {
    id: 'org.stor.finance',
    routes: [],
    ai: { 'category-pick': categoryPick },
};

export default finance;
