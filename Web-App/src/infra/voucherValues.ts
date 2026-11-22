/** The format of number, PIN and currency for the contract and for values from a PDF at the same time. */
import { failDomain } from './errorTexts';

/** Digits; spaces and hyphens are dropped, that is how retailers print the number. */
export function voucherNumber(v: unknown): string {
  const n = typeof v === 'string' && v.length <= 40 ? v.replace(/[\s-]/g, '') : '';
  if (!/^\d{4,25}$/.test(n)) failDomain('ungueltig', 'nummer_ungueltig');
  return n;
}

export function voucherPin(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const p = typeof v === 'string' ? v.trim() : '-';
  if (!p) return null;
  if (!/^\d{3,10}$/.test(p)) failDomain('ungueltig', 'pin_ungueltig');
  return p;
}

/** Without a value null: then the database sets the account's currency (migration 0073). */
export function voucherCurrency(v: unknown): string | null {
  if (v === null || v === undefined || v === '') return null;
  const w = typeof v === 'string' ? v.toUpperCase() : '';
  if (!/^[A-Z]{3}$/.test(w)) failDomain('ungueltig', 'waehrung_ungueltig');
  return w;
}

/** Only the end to the outside: a stolen app token should not grab all codes including PIN. */
export const PIN_MASK = '•••';
export const numberMask = (number: string) => `…${number.slice(-4)}`;

export function voucherNumberOrMask(v: unknown): string {
  return typeof v === 'string' && /^…\d{4}$/.test(v) ? v : voucherNumber(v);
}

/** When changing, null means "stays" and empty means "remove": that is why the empty value stays. */
export function voucherPinOrMask(v: unknown): string | null {
  if (v === PIN_MASK || (typeof v === 'string' && !v.trim())) return v === PIN_MASK ? v : '';
  return voucherPin(v);
}

export function voucherCurrencyChange(v: unknown): string | null {
  return v === '' ? '' : voucherCurrency(v);
}
