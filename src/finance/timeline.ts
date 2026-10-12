import { endOfMonth, format, parseISO } from 'date-fns';
import { formatNumber, MINUS } from '@hearthlog/sdk/format';
import { monthKeyOf } from '@hearthlog/sdk/axis';

/**
 * Pure helpers for the Finance timeline: which filter the URL asks for, which
 * months the endless list holds, and the geometry the balance line draws.
 * Balances and totals always come from SQLite.
 */

/** A plan is dated today or later; a row is done once marked done or once its day has passed. */
export type TimelineKind = 'planned' | 'done';
/** All lists done history above Today and plans below it; the others list one kind. */
export type TimelineShow = 'all' | TimelineKind;
/** 0 above the Today line (done up to today), 1 below it. */
export type TimelineSection = 0 | 1;

const DAY = 'yyyy-MM-dd';

/** All unless one kind is asked for; `?view=archive` links from the old Archived tab open done. */
export function parseShow(params: URLSearchParams): TimelineShow {
    const show = params.get('show');
    if (show === 'planned' || show === 'done') return show;
    return params.get('view') === 'archive' ? 'done' : 'all';
}

/** Whether a filter lists rows of a kind. */
export function showsKind(show: TimelineShow, kind: TimelineKind): boolean {
    return show === 'all' || show === kind;
}

export interface DateWindow {
    start: string;
    end: string;
}

// ---------------------------------------------------------------- endless ranges

/** Months listed before and after today's month; a hundred years each way feels endless. */
export const MONTH_SPAN = 1200;

/** First and last month a filter lists; null runs on endlessly. */
export interface MonthBounds {
    first: string | null;
    last: string | null;
}

/**
 * All runs both ways without end. Plans start at today's month and run on
 * ahead. Done history runs back without end and stops at today's month, or at
 * a later month holding a row marked done ahead of its date.
 */
export function monthBounds(show: TimelineShow, today: string, lastDone: string | null): MonthBounds {
    const current = monthKeyOf(today);
    if (show === 'all') return { first: null, last: null };
    if (show === 'planned') return { first: current, last: null };
    const done = lastDone ? monthKeyOf(lastDone) : current;
    return { first: null, last: done > current ? done : current };
}

/** The nearest month a filter lists. */
export function clampMonth(key: string, bounds: MonthBounds): string {
    if (bounds.first && key < bounds.first) return bounds.first;
    if (bounds.last && key > bounds.last) return bounds.last;
    return key;
}

/** First and last day of a `yyyy-MM` month. */
export function monthWindow(key: string): DateWindow {
    const first = parseISO(`${key}-01`);
    return { start: format(first, DAY), end: format(endOfMonth(first), DAY) };
}

// ---------------------------------------------------------------- geometry

/** A little air around the reached values, always including the floor. */
export function paddedDomain(min: number, max: number, floor: number, pad = 0.08): [number, number] {
    const lo = Math.min(min, max, floor);
    const hi = Math.max(min, max, floor);
    const span = hi - lo || Math.max(Math.abs(hi), 1);
    return [lo - span * pad, hi + span * pad];
}

/**
 * The scale for balance charts: the reached values, plus the floor only when
 * it is near them, so a distant floor (often 0) never flattens the line.
 */
export function outlookDomain(min: number, max: number, floor: number): [number, number] {
    const span = max - min || Math.max(Math.abs(max), 1);
    return paddedDomain(min, max, floor >= min - span * 0.25 ? floor : min);
}

/** Round tick values inside a domain: steps of 1, 2 or 5 times a power of ten. */
export function niceTicks(lo: number, hi: number, count: number): number[] {
    const span = hi - lo;
    if (!(span > 0) || count < 1) return [];
    const raw = span / count;
    const magnitude = 10 ** Math.floor(Math.log10(raw));
    const normalized = raw / magnitude;
    const step = (normalized < 1.5 ? 1 : normalized < 3 ? 2 : normalized < 7 ? 5 : 10) * magnitude;
    const ticks: number[] = [];
    for (let value = Math.ceil(lo / step) * step; value <= hi + step * 1e-9; value += step) {
        ticks.push(Math.round(value / step) * step);
    }
    return ticks;
}

/** `184k`, `−12k`, `950` — compact axis labels in the app locale. */
export function axisLabel(value: number): string {
    const magnitude = Math.abs(value);
    const text = magnitude >= 1000 ? `${formatNumber(Math.round(magnitude / 1000))}k` : formatNumber(Math.round(magnitude));
    return value < 0 ? `${MINUS}${text}` : text;
}
