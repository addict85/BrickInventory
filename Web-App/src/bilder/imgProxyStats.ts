import { fehlertext, meldeFehler } from '../infra/fehler';

// Eigenes Modul, damit Proxy und Vorschau zählen, ohne über global zu greifen.
export const imgProxyFailures = {
  timeout: 0,
  error: 0,
  notFound: 0,
  other: 0,
  lastError: null as string | null,
};

/** Ein Nebenschritt der Auslieferung scheiterte: Er hält die Antwort nicht auf, steht
 * aber in der Diagnose (Zähler und letzter Fehler), nicht nur im Protokoll. */
export function zaehleProxyFehler(ort: string, e: unknown): void {
  imgProxyFailures.other++;
  imgProxyFailures.lastError = `${ort}: ${fehlertext(e)}`;
  meldeFehler(ort, e);
}
