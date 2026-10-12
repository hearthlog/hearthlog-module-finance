import { aiInput, AiRequestError, type AiCapabilityDefinition } from '@hearthlog/contracts';
import { TRANSACTION_CATEGORIES } from '../finance/categories.js';
import type { CategoryPickItem } from '../finance/category-pick.js';

const MAX_NAME = 200;

const MEANINGS: Record<string, string> = {
    income: 'Money received: salary, refunds, interest',
    housing: 'Rent, mortgage, energy, water, home repairs',
    food: 'Groceries, restaurants, cafés, takeaway',
    transport: 'Fuel, public transport, taxis, parking, car costs',
    subscriptions: 'Recurring digital or membership services',
    health: 'Doctors, pharmacy, insurance for health, sport',
    shopping: 'Clothes, electronics, household goods, online shops',
    leisure: 'Entertainment, hobbies, culture, trips',
    kids: 'Children: school, childcare, toys, clothing',
    gifts: 'Gifts and donations',
    other: 'A real expense that fits none of the others',
};

/** Which category a bank transaction belongs to, picked by a small decision model. */
export const categoryPick: AiCapabilityDefinition = {
    options: () => TRANSACTION_CATEGORIES
        .filter((category) => category.value !== 'unknown')
        .map((category) => ({ value: category.value, meaning: MEANINGS[category.value] ?? category.label })),
    parseItem(value): CategoryPickItem {
        const item = aiInput.object(value);
        const direction = item.direction;
        if (direction !== 'income' && direction !== 'expense') throw new AiRequestError('Invalid direction');
        const amount = item.amount;
        if (typeof amount !== 'number' || !Number.isFinite(amount) || amount < 0 || amount > 1e12) {
            throw new AiRequestError('Invalid amount');
        }
        return { id: aiInput.id(item.id), name: aiInput.text(item.name, MAX_NAME), amount, direction };
    },
    question(item) {
        const transaction = item as CategoryPickItem;
        return {
            state: `Bank transaction of a Czech household. Name: ${JSON.stringify(transaction.name)}. ` +
                `Amount: ${transaction.amount} CZK (${transaction.direction}).`,
            instructions: 'Which category does this transaction belong to? Answer none if the name is unclear or no category fits.',
        };
    },
};
