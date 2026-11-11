/** Die einzige Stelle, an der eine fachliche Fehlerart zum HTTP-Status wird. */
import { Fachfehler, type FehlerArt } from '../infra/fehlerTexte';

export const STATUS_DER_ART: Readonly<Record<FehlerArt, number>> = {
  ungueltig: 400,
  nicht_angemeldet: 401,
  verboten: 403,
  nicht_gefunden: 404,
  konflikt: 409,
  zu_gross: 413,
  falscher_typ: 415,
  zu_viele: 429,
  intern: 500,
  fremddienst: 502,
  nicht_verfuegbar: 503,
  zeitueberschreitung: 504,
};

/** Status eines geworfenen Fehlers: Fachfehler nach Art, Fehler von Express
 * oder Bibliotheken nach ihrem eigenen `status`, alles andere 500. */
export function statusVon(e: unknown): number {
  if (e instanceof Fachfehler) return STATUS_DER_ART[e.art] ?? 500;
  const s = (e as { status?: unknown } | null | undefined)?.status;
  return typeof s === 'number' ? s : 500;
}
