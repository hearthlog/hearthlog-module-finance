/**
 * The banks linked through Enable Banking: its name for each and the country it lists the bank under. That is the
 * country of the bank's licence, not the customer's: Revolut serves Czech customers as Revolut Bank UAB, listed under
 * Lithuania, and an app still in restricted mode accepts only the bank and country its accounts were linked under.
 */
export const APPROVAL_BANKS: Record<string, { aspsp: string; country: string; label: string }> = {
    revolut: { aspsp: 'Revolut', country: 'LT', label: 'Revolut' },
};
