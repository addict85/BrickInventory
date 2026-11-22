/**
 * Typprobe des Vertragsrouters, geprüft von `npm run typecheck` (tsconfig.json), nie ausgeführt:
 * Jede Zeile unter `@ts-expect-error` muss ein Übersetzungsfehler bleiben. Kompiliert
 * eine davon, meldet tsc die überflüssige Markierung — dann ist die Prüfung weg.
 *
 * Gegenproben (14.11.2026, je einzeln):
 *   A  `KeyBelow<P>` durch `Schluessel` ersetzt → rot an „Präfix passt nicht“.
 *   B  `endpoint(schluessel: string, …)` statt `K extends KeyBelow<P>` → rot an
 *      allen vier Zeilen (unbekannter Schlüssel, Präfix, Antwort, Pfadparameter).
 *   C  `Ergebnis<K>` durch `Record<string, unknown>` ersetzt → rot an „Antwort weicht ab“.
 */
import type { ContractRouter } from '../../src/http/contractRouter';

declare const api: ContractRouter<'/api/v2'>;
declare const auth: ContractRouter<'/api/v2/auth'>;

// Richtig: Methode und Pfad aus dem Schlüssel, die Antwort ohne Hülle.
api.endpoint('GET /api/v2/sets', req => ({ count: 0, total: req.queryArgs.page ?? 0, sets: [] }));
auth.endpoint('POST /api/v2/auth/qr-login/discard', req => (req.input.pickup ? {} : undefined));

// @ts-expect-error Ein Schlüssel, den der Vertrag nicht kennt.
api.endpoint('GET /api/v2/sets/:gibtEsNicht/x', () => undefined);

// @ts-expect-error Präfix passt nicht: Der Auth-Router hängt unter /api/v2/auth.
auth.endpoint('GET /api/v2/sets', () => undefined);

// @ts-expect-error Die Antwort weicht vom Vertrag ab (`count` ist eine Zahl).
api.endpoint('GET /api/v2/sets', () => ({ count: 'viele', total: 0, sets: [] }));

// @ts-expect-error Ein Pfadparameter, den der Schlüssel nicht hat.
api.endpoint('GET /api/v2/sets', req => ({ count: req.pathArgs.setNumber.length, total: 0, sets: [] }));
