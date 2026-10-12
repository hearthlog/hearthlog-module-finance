import { addDays, format, parseISO } from "date-fns";
import type { Transaction } from "../../data/transactions.js";

/** A daily repeat adds at most a year of transactions in one save. */
export const MAX_REPEAT_DAYS = 366;

export interface TransactionDraft {
    id?: string;
    name: string;
    amount: number;
    dueDate: string;
    category: string;
    status: "active" | "archived";
    direction: "expense" | "income";
    /**
     * Where the category came from (`manual`, `history`, `ai:<model>`). Left
     * undefined when the category was not touched, so a save keeps what is stored.
     */
    categorySource?: string;
}

export function createTransactionDraft(
    dueDate: string,
    transaction?: Transaction,
): TransactionDraft {
    if (!transaction) {
        return {
            name: "",
            amount: 0,
            dueDate,
            category: "unknown",
            status: "active",
            direction: "expense",
        };
    }

    return {
        id: transaction.id,
        name: transaction.name ?? "",
        amount: Math.abs(transaction.amount),
        dueDate: transaction.due_date?.slice(0, 10) ?? dueDate,
        category: transaction.transaction_category || "unknown",
        status:
            transaction.transaction_status === "archived"
                ? "archived"
                : "active",
        direction: transaction.amount >= 0 ? "income" : "expense",
    };
}

/**
 * Only an entry dated today asks whether it already happened: earlier days
 * are done by their date and later days are plans.
 */
export function canMarkHappened(draft: TransactionDraft, today: string): boolean {
    return draft.dueDate !== "" && draft.dueDate === today;
}

/** "Already happened" starts checked for a transaction that is done, and unchecked for a plan or a new entry. */
export function defaultHappened(initialStatus: TransactionDraft["status"]): boolean {
    return initialStatus === "archived";
}

/**
 * An existing row marked done ahead of its day. It stays done on another
 * later date, while a row that is done only because its day passed turns
 * back into a plan.
 */
export function isDoneAhead(initial: TransactionDraft, today: string): boolean {
    return !!initial.id && initial.status === "archived" && today !== "" && initial.dueDate >= today;
}

/**
 * The status a save stores. Anything dated before today is done, today
 * follows "Already happened", and a later date is a plan unless the row was
 * already done ahead of its day.
 */
export function resolveDraftStatus(
    draft: TransactionDraft,
    today: string,
    alreadyHappened: boolean,
    doneAhead = false,
): TransactionDraft["status"] {
    if (!draft.dueDate || !today) return draft.id ? draft.status : "active";
    if (draft.dueDate < today) return "archived";
    if (draft.dueDate === today) return alreadyHappened ? "archived" : "active";
    return doneAhead ? "archived" : "active";
}

/** A daily repeat covers two to {@link MAX_REPEAT_DAYS} whole days. */
export function isRepeatDays(days: number): boolean {
    return Number.isInteger(days) && days >= 2 && days <= MAX_REPEAT_DAYS;
}

/**
 * The transactions one save creates: the draft itself, or one per day for a
 * daily repeat of a new transaction. Days before today are done, today
 * follows "Already happened", and later days stay plans.
 */
export function expandDraft(
    draft: TransactionDraft,
    days: number,
    today: string,
    alreadyHappened: boolean,
    doneAhead = false,
): TransactionDraft[] {
    if (draft.id || !draft.dueDate || !isRepeatDays(days)) return [{ ...draft, status: resolveDraftStatus(draft, today, alreadyHappened, doneAhead) }];
    const start = parseISO(draft.dueDate);
    return Array.from({ length: days }, (_, index) => {
        const day = { ...draft, dueDate: format(addDays(start, index), "yyyy-MM-dd") };
        return { ...day, status: resolveDraftStatus(day, today, alreadyHappened) };
    });
}

/** `28 Sep – 11 Oct`, naming the years only when the range crosses one. */
export function formatDayRange(first: string, last: string): string {
    const start = parseISO(first);
    const end = parseISO(last);
    const pattern = start.getFullYear() === end.getFullYear() ? "d MMM" : "d MMM yyyy";
    return `${format(start, pattern)} – ${format(end, pattern)}`;
}
