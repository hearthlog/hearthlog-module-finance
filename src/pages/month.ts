import { deferPage, type PagePublisher } from '@hearthlog/sdk/runtime';
import type { ModuleLoadEvent } from '@hearthlog/sdk/runtime';
import type { Asset } from '../data/assets.js';
import type { BudgetItem } from '@hearthlog/sdk/data';
import type { BudgetItemSort, BudgetPlanSummary } from '../data/budgets.js';
import type { BalanceRange, TimelineOutlook } from '../data/finance-timeline.js';
import { queryDatabase } from '@hearthlog/sdk/data';
import { parseBudgetItemSort } from '../data/budgets.js';
import { loadBalanceFloor } from '../finance/floor.js';
import { appClock } from '@hearthlog/sdk/runtime';
import { format } from 'date-fns';

export interface FinancePageData {
    /** The month the endless views open at; today's month opens at Today. */
    year: number;
    month: number;
    today: string;
    outlook: TimelineOutlook;
    /** Lowest and highest balance over all history and every plan: one fixed scale. */
    range: BalanceRange;
    floor: number;
    assets: Asset[];
    assetsSum: number;
    budgetPlans: BudgetPlanSummary[];
    budgetIncomeItems: BudgetItem[];
    budgetExpenseItems: BudgetItem[];
    selectedPlanId: string | null;
    incomeSort: BudgetItemSort | null;
    expenseSort: BudgetItemSort | null;
}

function emptyData(year: number, month: number): FinancePageData {
    return {
        year,
        month,
        today: '',
        outlook: { available: 0, low: { amount: 0, date: '' }, end: 0, endDate: null, lastDone: null },
        range: { min: 0, max: 0 },
        floor: 0,
        assets: [],
        assetsSum: 0,
        budgetPlans: [],
        budgetIncomeItems: [],
        budgetExpenseItems: [],
        selectedPlanId: null,
        incomeSort: null,
        expenseSort: null,
    };
}

const loadData = async (
    { params, parent, url }: ModuleLoadEvent,
    publish: PagePublisher<FinancePageData>,
): Promise<FinancePageData> => {
    // The layout's load supplies the assets; the route loader receives untyped parent data.
    const { assetsData } = await parent() as { assetsData: Promise<{ assets: Asset[]; assetsSum: number }> };
    const assetsReady = assetsData.then((value) => { publish(value, 'assets'); return value; });
    void assetsReady.catch(() => undefined);
    const now = await appClock.ready();
    const today = format(now, 'yyyy-MM-dd');
    const isBudgetTab = url.searchParams.get('tab') === 'budget';
    const requestedPlanId = url.searchParams.get('plan');
    const incomeSort = parseBudgetItemSort(url.searchParams.get('incomeSort'));
    const expenseSort = parseBudgetItemSort(url.searchParams.get('expenseSort'));

    // The endless views read the months and weeks that scroll into view on
    // their own; the page loads what spans all of them.
    const [{ assets, assetsSum }, floor, result] = await Promise.all([
        assetsReady,
        loadBalanceFloor(),
        queryDatabase(async (repositories) => {
            const [outlook, range, budgetPlans] = await Promise.all([
                repositories.timeline.getOutlook({ today }),
                repositories.timeline.getRange({ today }),
                isBudgetTab ? repositories.budgets.getPlans() : Promise.resolve([] as BudgetPlanSummary[]),
            ]);
            const selectedPlan = budgetPlans.find((plan) => plan.id === requestedPlanId) ?? budgetPlans[0];
            const [budgetIncomeItems, budgetExpenseItems] = selectedPlan
                ? await Promise.all([
                    repositories.budgets.getPlanItems(selectedPlan.id, 'income', incomeSort),
                    repositories.budgets.getPlanItems(selectedPlan.id, 'expense', expenseSort),
                ])
                : [[], []];
            return { outlook, range, budgetPlans, budgetIncomeItems, budgetExpenseItems, selectedPlanId: selectedPlan ? selectedPlan.id : null };
        }),
    ]);

    return { year: Number(params.year ?? 0), month: Number(params.month ?? 0), today, floor, assets, assetsSum, incomeSort, expenseSort, ...result };
};

export const load = (event: ModuleLoadEvent) => {
    event.depends('app:transactions');
    event.depends('app:budgets');
    return deferPage<FinancePageData>(
        event,
        emptyData(Number(event.params.year ?? 0), Number(event.params.month ?? 0)),
        (publish) => loadData(event, publish),
    );
};
