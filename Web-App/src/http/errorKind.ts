/** The only place where a domain error kind becomes an HTTP status. */
import { DomainError, type ErrorKind } from '../infra/errorTexts';

export const STATUS_THE_KIND: Readonly<Record<ErrorKind, number>> = {
  invalid: 400,
  not_signed_in: 401,
  forbidden: 403,
  not_found: 404,
  conflict: 409,
  too_large: 413,
  unsupported_type: 415,
  request_timeout: 408,
  gone: 410,
  unprocessable: 422,
  too_many: 429,
  storage_full: 507,
  internal: 500,
  upstream: 502,
  unavailable: 503,
  upstream_timeout: 504,
  misdirected: 421,
  upgrade_required: 426,
};

/** Status of a thrown error: domain errors by kind, errors from Express
 * or libraries by their own `status`, everything else 500. */
export function statusOf(e: unknown): number {
  if (e instanceof DomainError) return STATUS_THE_KIND[e.kind] ?? 500;
  const s = (e as { status?: unknown } | null | undefined)?.status;
  return typeof s === 'number' ? s : 500;
}
