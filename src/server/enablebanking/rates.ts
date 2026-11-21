/**
 * Czech National Bank daily rates: Finance counts in Kč, so a Revolut pocket in another currency is converted at the
 * day's ČNB rate (its native amount is kept beside). One fetch per run; the file is public and carries no user data.
 */

export const CNB_DAILY = 'https://www.cnb.cz/cs/financni-trhy/devizovy-trh/kurzy-devizoveho-trhu/kurzy-devizoveho-trhu/denni_kurz.txt';

/** Kč per one unit of each currency, from the ČNB daily text ("země|měna|množství|kód|kurz"). */
export function parseCnbRates(text: string): Map<string, number> {
    const rates = new Map<string, number>([['CZK', 1]]);
    for (const line of text.split(/\r?\n/).slice(2)) {
        const [, , amount, code, rate] = line.split('|');
        const value = Number((rate ?? '').replace(',', '.')) / Number(amount);
        if (code && Number.isFinite(value) && value > 0) rates.set(code.trim().toUpperCase(), value);
    }
    return rates;
}

export type RateLookup = (currency: string) => Promise<number | null>;

/** A lookup that fetches the day's rates once, the first time a foreign currency is asked for. */
export function cnbRates(fetcher: typeof fetch = fetch): RateLookup {
    let rates: Promise<Map<string, number>> | null = null;
    return async (currency) => {
        const code = currency.toUpperCase();
        if (code === 'CZK') return 1;
        rates ??= fetcher(CNB_DAILY).then(async (response) => {
            if (!response.ok) throw new Error(`ČNB rates: ${response.status}`);
            return parseCnbRates(await response.text());
        });
        try {
            return (await rates).get(code) ?? null;
        } catch {
            rates = null;
            return null;
        }
    };
}
