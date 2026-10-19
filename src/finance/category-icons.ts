import type { Component } from 'svelte';
import IconTag from '~icons/mdi/tag-outline';
import IconIncome from '~icons/mdi/wallet-outline';
import IconHousing from '~icons/mdi/home-outline';
import IconFood from '~icons/mdi/cart-outline';
import IconTransport from '~icons/mdi/car-outline';
import IconSubscriptions from '~icons/mdi/autorenew';
import IconHealth from '~icons/mdi/heart-pulse';
import IconShopping from '~icons/mdi/shopping-outline';
import IconLeisure from '~icons/mdi/ticket-outline';
import IconKids from '~icons/mdi/baby-face-outline';
import IconGifts from '~icons/mdi/gift-outline';
import IconOther from '~icons/mdi/dots-horizontal-circle-outline';

const ICONS: Record<string, Component> = {
    income: IconIncome,
    housing: IconHousing,
    food: IconFood,
    transport: IconTransport,
    subscriptions: IconSubscriptions,
    health: IconHealth,
    shopping: IconShopping,
    leisure: IconLeisure,
    kids: IconKids,
    gifts: IconGifts,
    other: IconOther,
};

/** The line icon a category draws in its row's tile; uncategorized rows get a plain tag. */
export function categoryIcon(value: string | null | undefined): Component {
    return ICONS[value ?? ''] ?? IconTag;
}
