import { getDeviceSetting as kvGet, setDeviceSetting as kvSet } from '@hearthlog/sdk/runtime';

/**
 * The balance floor is a personal warning line ("tell me when a plan takes me
 * below 20 000 Kč"). It is a device preference, like calculator inputs, so it
 * lives in local KV and never becomes an event.
 */

const FLOOR_KEY = 'finance:balance-floor';

export function parseFloor(value: unknown): number | null {
    if (typeof value === 'number') return Number.isFinite(value) ? Math.round(value) : null;
    if (typeof value !== 'string') return null;
    const digits = value.replace(/[\s  ]/g, '').replace(/kč$/i, '').replace('−', '-');
    if (!/^-?\d+$/.test(digits)) return null;
    return Number(digits);
}

export async function loadBalanceFloor(): Promise<number> {
    try {
        return parseFloor(await kvGet<unknown>(FLOOR_KEY)) ?? 0;
    } catch {
        return 0;
    }
}

export function saveBalanceFloor(value: number): Promise<void> {
    return kvSet(FLOOR_KEY, value);
}
