import path from 'path';
import type { Response } from 'express';

/**
 * Eine Datei ausliefern — und einen Fehler dabei auf die RICHTIGE Antwort
 * abbilden.
 * Ausführlich: docs/begruendungen/src/infra/dateiAusliefern.ts.md#dateifehler
 */

/** Fehler, wie `send` sie erzeugt: mit einer HTTP-Zahl daran. */
type DateiFehler = Error & { status?: number; statusCode?: number; code?: string };

/**
 * Die Zahl aus einem `send`-Fehler holen. `send` benutzt `status`,
 * http-errors setzt zusaetzlich `statusCode` — beide nachsehen, damit ein
 * Fassungswechsel der Bibliothek diese Stelle nicht still unwirksam macht.
 */
function zahlAus(err: unknown): number | null {
  const e = err as DateiFehler | null | undefined;
  const n = e?.status ?? e?.statusCode;
  return typeof n === 'number' && n >= 400 && n <= 599 ? n : null;
}

/**
 * Antwort auf einen Fehler aus res.sendFile().
 *
 * Nichts tun, wenn schon etwas rausgegangen ist: Das ist der Abbruch durch den
 * Client (er legt mitten im Download auf). Eine zweite Antwort waere ein
 * Fehler im Log und nichts sonst.
 */
export function antwortAufDateiFehler(res: Response, err: unknown): void {
  if (res.headersSent || res.writableEnded) return;
  const zahl = zahlAus(err);
  // 404 bleibt 404 — und alles ohne eigene Zahl auch: Ein Fehler, den wir
  // nicht einordnen koennen, an dieser Stelle heisst fast immer „die Datei
  // ist nicht da" (ENOENT, ENOTDIR).
  if (zahl === null || zahl === 404) {
    res.status(404).send('Datei nicht gefunden');
    return;
  }
  // 416 traegt bereits ein Content-Range, das `send` vor dem Fehler gesetzt
  // hat („bytes */<laenge>"). Das bleibt stehen und sagt dem Client, wie lang
  // die Datei wirklich ist — genau die Auskunft, die er braucht.
  res.sendStatus(zahl);
}

/**
 * res.sendFile mit dem Ordner als `root`: So prüft `send` nur den Dateinamen
 * auf einen führenden Punkt. Mit dem ganzen Pfad antwortete jede Datei mit
 * 404, sobald die Installation unter einem Punkt-Ordner liegt (~/.local,
 * ein Arbeitsbaum unter .claude/).
 */
export function sendeDatei(res: Response, pfad: string, fertig: (err?: Error) => void): void {
  res.sendFile(path.basename(pfad), { root: path.dirname(pfad) }, fertig);
}

/**
 * Datei ausliefern, Fehler richtig beantworten. Der gemeinsame Weg fuer alle
 * Routen, die nichts Besonderes tun, wenn die Datei fehlt.
 */
export function liefereDatei(res: Response, pfad: string): void {
  sendeDatei(res, pfad, (err?: Error) => {
    if (err) antwortAufDateiFehler(res, err);
  });
}
