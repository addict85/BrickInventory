import path from 'path';
import type { Response } from 'express';

// Ein Fehler beim Ausliefern bekommt seine eigene Antwort statt pauschal 404.
// Ausführlich: docs/begruendungen/src/http/dateiAusliefern.ts.md#dateifehler

type DateiFehler = Error & { status?: number; statusCode?: number; code?: string };

/** `status` und `statusCode` beide nachsehen, damit ein Fassungswechsel der
 * Bibliothek diese Stelle nicht still unwirksam macht. */
function zahlAus(err: unknown): number | null {
  const e = err as DateiFehler | null | undefined;
  const n = e?.status ?? e?.statusCode;
  return typeof n === 'number' && n >= 400 && n <= 599 ? n : null;
}

/** Ist schon etwas hinaus, hat der Client abgebrochen; eine zweite Antwort
 * wäre nur ein Fehler im Log. */
export function antwortAufDateiFehler(res: Response, err: unknown): void {
  if (res.headersSent || res.writableEnded) return;
  const zahl = zahlAus(err);
  // Ohne eigene Zahl heisst es hier fast immer „die Datei ist nicht da".
  if (zahl === null || zahl === 404) {
    res.status(404).send('Datei nicht gefunden');
    return;
  }
  // 416 trägt schon das Content-Range („bytes */<länge>"), das der Client braucht.
  res.sendStatus(zahl);
}

/** Mit dem Ordner als `root`: Mit dem ganzen Pfad antwortete jede Datei 404,
 * sobald die Installation unter einem Punkt-Ordner liegt. */
export function sendeDatei(res: Response, pfad: string, fertig: (err?: Error) => void): void {
  res.sendFile(path.basename(pfad), { root: path.dirname(pfad) }, fertig);
}

export function liefereDatei(res: Response, pfad: string): void {
  sendeDatei(res, pfad, (err?: Error) => {
    if (err) antwortAufDateiFehler(res, err);
  });
}
