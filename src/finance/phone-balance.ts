import { getDeviceSetting as kvGet, setDeviceSetting as kvSet } from '@hearthlog/sdk/runtime';

/**
 * Whether a phone shows the running balance, the balance line and each month's
 * figures in the transactions list. A device preference like the floor, so it
 * lives in local KV and never becomes an event. Off until someone turns it on;
 * wider screens always show them.
 */

const PHONE_BALANCE_KEY = 'finance:phone-balance';

export async function loadPhoneBalance(): Promise<boolean> {
    try {
        return (await kvGet<unknown>(PHONE_BALANCE_KEY)) === true;
    } catch {
        return false;
    }
}

export function savePhoneBalance(on: boolean): Promise<void> {
    return kvSet(PHONE_BALANCE_KEY, on);
}
