/**
 * Typprobe des Vertragsrouters, geprüft von `npm run typecheck` (tsconfig.json), nie ausgeführt:
 * Jede Zeile unter `@ts-expect-error` muss ein Übersetzungsfehler bleiben. Kompiliert
 * eine davon, meldet tsc die überflüssige Markierung — dann ist die Prüfung weg.
 *
 * Gegenproben (14.11.2026, je einzeln):
 *   A  `SchluesselUnter<P>` durch `Schluessel` ersetzt → rot an „Präfix passt nicht“.
 *   B  `endpunkt(schluessel: string, …)` statt `K extends SchluesselUnter<P>` → rot an
 *      allen vier Zeilen (unbekannter Schlüssel, Präfix, Antwort, Pfadparameter).
 *   C  `Ergebnis<K>` durch `Record<string, unknown>` ersetzt → rot an „Antwort weicht ab“.
 */
import type { VertragsRouter } from '../../src/http/vertragsRouter';

declare const api: VertragsRouter<'/api/v1'>;
declare const auth: VertragsRouter<'/api/v1/auth'>;

// Richtig: Methode und Pfad aus dem Schlüssel, die Antwort ohne Hülle.
api.endpunkt('GET /api/v1/sets', req => ({ count: 0, total: req.abfrage.page ?? 0, sets: [] }));
auth.endpunkt('POST /api/v1/auth/qr-login/verwerfen', req => (req.eingabe.abholung ? {} : undefined));

// @ts-expect-error Ein Schlüssel, den der Vertrag nicht kennt.
api.endpunkt('GET /api/v1/sets/:gibtEsNicht/x', () => undefined);

// @ts-expect-error Präfix passt nicht: Der Auth-Router hängt unter /api/v1/auth.
auth.endpunkt('GET /api/v1/sets', () => undefined);

// @ts-expect-error Die Antwort weicht vom Vertrag ab (`count` ist eine Zahl).
api.endpunkt('GET /api/v1/sets', () => ({ count: 'viele', total: 0, sets: [] }));

// @ts-expect-error Ein Pfadparameter, den der Schlüssel nicht hat.
api.endpunkt('GET /api/v1/sets', req => ({ count: req.pfad.setNumber.length, total: 0, sets: [] }));
