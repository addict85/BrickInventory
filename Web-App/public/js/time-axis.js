// Ticks of a time axis: whole hours, midnights or month starts, as many as fit.

import { LANG, locale } from '../i18n.js';

export const DAY_MS = 864e5;
const timeFormat = (/** @type {Intl.DateTimeFormatOptions} */ o) => new Intl.DateTimeFormat(locale(), o);

/** Ticks at whole hours. @param {number} of @param {number} bis @param {number} max */
function hourTicks(of, bis, max) {
  const h = [1, 2, 3, 6, 12, 24].find(x => Math.max(1, bis - of) / (x * 36e5) <= max) ?? 24;
  const f = timeFormat({ hour: '2-digit', minute: '2-digit' });
  const out = [];
  for (let t = Math.ceil(of / (h * 36e5)) * h * 36e5; t <= bis; t += h * 36e5) out.push({ t, text: f.format(t) });
  return out;
}

/** Ticks at midnight, every n days. @param {number} of @param {number} bis @param {number} max */
function dayTicks(of, bis, max) {
  const timeSpan = Math.max(1, bis - of);
  const n = [1, 2, 7, 14].find(x => timeSpan / (x * DAY_MS) <= max) ?? 14;
  const f = timeFormat(LANG === 'en' ? { day: 'numeric', month: 'short' } : { day: '2-digit', month: '2-digit' });
  const d = new Date(of);
  d.setHours(0, 0, 0, 0);
  if (d.getTime() < of) d.setDate(d.getDate() + 1);
  const out = [];
  for (; d.getTime() <= bis; d.setDate(d.getDate() + n)) out.push({ t: d.getTime(), text: f.format(d) });
  return out;
}

/** Ticks at the first of a month, on multiples of n months. @param {number} of @param {number} bis @param {number} max */
function monthTicks(of, bis, max) {
  const months = Math.max(1, bis - of) / (30.44 * DAY_MS);
  const n = [1, 2, 3, 6, 12, 24].find(x => months / x <= max) ?? 24;
  const f = timeFormat({ month: 'short', year: 'numeric' });
  const d = new Date(of);
  d.setDate(1);
  d.setHours(0, 0, 0, 0);
  if (d.getTime() < of) d.setMonth(d.getMonth() + 1);
  while (d.getMonth() % n) d.setMonth(d.getMonth() + 1);
  const out = [];
  for (; d.getTime() <= bis; d.setMonth(d.getMonth() + n)) out.push({ t: d.getTime(), text: f.format(d) });
  return out;
}

/**
 * Ticks of a time axis with uniform labels: hours within a day, days up to three months, beyond that
 * months ("Nov. 2025"). Days in German as digits like every date in the text ("13.09." for "13.09.2026");
 * "13. Sept." next to it read like a second format. English with month names like fmtDate.
 * @param {number} of @param {number} bis  milliseconds
 * @param {number} maxStrokes
 * @returns {{ t: number, text: string }[]}
 */
export function timeSplit(of, bis, maxStrokes) {
  const timeSpan = Math.max(1, bis - of),
    max = Math.max(2, maxStrokes);
  const ticks = timeSpan <= 2 * DAY_MS ? hourTicks : timeSpan <= 92 * DAY_MS ? dayTicks : monthTicks;
  const out = ticks(of, bis, max);
  // If even the largest step does not fit (narrow phone), only every k-th tick.
  if (out.length > max) {
    const k = Math.ceil(out.length / max);
    return out.filter((_, i) => i % k === 0);
  }
  return out;
}
