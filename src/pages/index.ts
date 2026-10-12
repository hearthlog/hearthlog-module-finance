import { redirect } from '@sveltejs/kit';
import type { ModuleLoadEvent } from '@hearthlog/sdk/runtime';

export const load = ({ url }: ModuleLoadEvent) => {
    const now = new Date();
    redirect(307, `/finance/${now.getFullYear()}/${now.getMonth() + 1}${url.search}`);
};
