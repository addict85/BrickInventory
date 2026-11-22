/** The only place where a domain error kind becomes an HTTP status. */
import { DomainError, type ErrorKind } from '../infra/errorTexts';

export const STATUS_THE_KIND: Readonly<Record<ErrorKind, number>> = {
  ungueltig: 400,
  nicht_angemeldet: 401,
  verboten: 403,
  nicht_gefunden: 404,
  konflikt: 409,
  zu_gross: 413,
  falscher_typ: 415,
  zu_langsam: 408,
  nicht_mehr_da: 410,
  nicht_verarbeitbar: 422,
  zu_viele: 429,
  speicher_voll: 507,
  intern: 500,
  fremddienst: 502,
  nicht_verfuegbar: 503,
  zeitueberschreitung: 504,
  falscher_host: 421,
  zu_alt: 426,
};

/** Status of a thrown error: domain errors by kind, errors from Express
 * or libraries by their own `status`, everything else 500. */
export function statusOf(e: unknown): number {
  if (e instanceof DomainError) return STATUS_THE_KIND[e.art] ?? 500;
  const s = (e as { status?: unknown } | null | undefined)?.status;
  return typeof s === 'number' ? s : 500;
}
