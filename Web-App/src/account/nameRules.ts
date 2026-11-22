/** What is acceptable as username, login name and device name. */
import * as V from '../infra/validate';

export const USERNAME_RE = /^[A-Za-z0-9_.-]{3,32}$/;

/** A name is free text, but not a carrier for addresses or line breaks:
 * it appears in UIs and exports, where a link would look as if from the server. */
export function nameValid(v: unknown): boolean {
  if (v === undefined || v === null || v === '') return true;
  const s = String(v);
  return s.length <= 100 && !/[\p{Cc}\u2028\u2029]/u.test(s) && !/:\/\/|www\.|https?:/i.test(s);
}

/** Device and passkey names appear literally in the notice mails: without addresses and
 * quotes an intruder cannot append a reassuring sentence with a link there. */
export function devicesNameValid(v: unknown): boolean {
  return nameValid(v) && devicesNameContentValid(v);
}

/** The same rule without length: token labels of the login are truncated instead of rejected. */
export function devicesNameContentValid(v: unknown): boolean {
  if (typeof v !== 'string') return true;
  return (
    !/[\p{Cc}\u2028\u2029]/u.test(v) &&
    !/:\/\/|www\.|https?:/i.test(v) &&
    !/["'`«»„“”‚‘’<>]/u.test(v) &&
    !/[\p{L}\d-]\.\p{L}{2,}(?![\p{L}\d])/u.test(v)
  );
}

export const EMAIL_RE = V.EMAIL_RE,
  emailValid: typeof V.emailValid = V.emailValid;

/** Name OR email, because the login searches both columns. */
export function loginNameValid(value: unknown): boolean {
  const v = String(value || '');
  return USERNAME_RE.test(v) || emailValid(v);
}
