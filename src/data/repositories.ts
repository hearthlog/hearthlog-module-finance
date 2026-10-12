/** Finance's read repositories, added to `queryDatabase` by the composer. */

import type { ReadModelSession } from '@hearthlog/sdk/data';
import { createAssetRepository } from './assets.js';
import { createBudgetRepository } from './budgets.js';
import { createTimelineRepository } from './finance-timeline.js';
import { createForecastRepository } from './forecast.js';
import { createPlannedDaysRepository } from './planned-days.js';
import { createTransactionRepository } from './transactions.js';

export function createRepositories(session: ReadModelSession) {
    return {
        assets: createAssetRepository(session),
        budgets: createBudgetRepository(session),
        forecasts: createForecastRepository(session),
        plannedDays: createPlannedDaysRepository(session),
        timeline: createTimelineRepository(session),
        transactions: createTransactionRepository(session),
    };
}
