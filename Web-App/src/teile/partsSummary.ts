/**
 * Vorberechnete Teile-Zusammenfassung.
 * Ausführlich: docs/begruendungen/src/teile/partsSummary.ts.md#abschnitt
 */
import { meldeUndLiefere } from '../infra/httpError';
import * as db from '../../db/database';
import * as repo from './repository/teileZusammenfassung';

/** Stand der Rohdaten dieses Kontos, und ob Katalogänderungen offen sind (Migration 0079). */
const currentVersion = repo.rohstand;

/** Baut die Zusammenfassung eines Nutzers neu auf. */
export async function rebuild(userId: number, version?: { v: number }): Promise<void> {
  const stand = version ?? await currentVersion(userId);
  // Ob DIESER Aufruf gebaut hat. Der Block unten verlaesst die Transaktion
  // vorzeitig, wenn ein anderer Arbeiter die Sperre haelt — dann hat hier
  // nichts geschrieben, und nachzupflegen waere 240 ms fuer nichts.
  let gebaut = false;
  await db.transaction(async (tx) => {
    // Sperre über die Datenbank, nicht nur über die In-Memory-Map
    // (_rebuilding) weiter unten.
    // Ausführlich: docs/begruendungen/src/teile/partsSummary.ts.md#rebuild-lock
    if (!(await repo.sperreKonto(tx, userId))) {
      // Ein anderer Worker baut gerade für denselben Nutzer — dessen Ergebnis gilt gleich mit.
      return;
    }
    await repo.baueNeu(tx, userId, stand.v);
    gebaut = true;
  });

  // Neuaufbau = Masseneinfügen: Ohne frische Statistik wählt der Planer den
  // falschen Index (db/tabellePflegen.ts). Höchstens alle zehn Minuten,
  // weil ANALYZE die Tabelle aller Konten vermisst. VACUUM entfällt, seit die
  // GIN-Indizes keine Warteliste führen (Migration 0054).
  if (gebaut && Date.now() - _letzteAnalyse > 10 * 60_000) {
    _letzteAnalyse = Date.now();
    await repo.analysiere().catch((e: Error) => console.warn('[partsSummary] ANALYZE:', e.message));
  }
}

/**
 * Stellt sicher, dass die Zusammenfassung aktuell ist.
 * @returns true, wenn sie benutzbar ist
 */
let _letzteAnalyse = 0;

/** Laufende Neuaufbauten je Nutzer — verhindert Mehrfachläufe. */
const _rebuilding = new Map<number, Promise<void>>();

function rebuildInBackground(userId: number, v: { v: number }) {
  if (_rebuilding.has(userId)) return;
  const p = rebuild(userId, v)
    .catch(e => console.error('[partsSummary] Hintergrundaufbau:', e.message))
    .finally(() => { _rebuilding.delete(userId); });
  _rebuilding.set(userId, p);
}

/**
 * Ist die Zusammenfassung für diesen Nutzer benutzbar?
 * Ausführlich: docs/begruendungen/src/teile/partsSummary.ts.md#ensurefresh
 */
export async function ensureFresh(userId: number | number[], opts?: { strict?: boolean }): Promise<boolean> {
  // Haushalt: je Konto prüfen, alle müssen mitspielen
  // Die Tabelle ist je Konto aufgebaut (Schlüssel user_id, part_key, color_id);
  // gelesen wird sie für den Haushalt mit user_id = ANY(...) und über part_key
  // verdichtet. Frisch ist die Sicht nur, wenn sie es für JEDES beteiligte …
  // Ausführlich: docs/begruendungen/src/teile/partsSummary.ts.md#ensurefresh-ids
  const ids = Array.isArray(userId) ? userId : [userId];
  if (ids.length > 1) {
    const results = await Promise.all(ids.map(id => ensureFresh(id, opts)));
    return results.every(Boolean);
  }
  // Ein Blickfeld mit genau einem Konto — der Fall darueber hat mehrere
  // bereits abgehandelt, eine leere Liste kann es nach `[userId]` nicht geben.
  userId = ids[0] ?? 0;
  try {
    const [v, state] = await Promise.all([
      currentVersion(userId as number),
      repo.gebauterStand(userId).catch(meldeUndLiefere('teile-zsf:get', null)),
    ]);
    // Offene Katalogänderungen zuerst nachziehen; hält ein anderer Prozess
    // die Sperre, ist der Stand in diesem Moment nicht gesichert.
    const katalogNachgezogen = !v.katalogOffen || (await katalogEinmalNachziehen()) !== null;
    if (state === v.v && katalogNachgezogen) return true;

    rebuildInBackground(userId, v);

    // strict: Nur ein AKTUELLER Stand zählt.
    // Ausführlich: docs/begruendungen/src/teile/partsSummary.ts.md#ensurefresh-2
    if (opts?.strict) return false;

    // Veraltete Zahlen sind besser als drei Sekunden Wartezeit; gibt es noch
    // gar keinen Stand, muss der Aufrufer live abfragen.
    return state !== null;
  } catch (e: any) {
    // Schlägt etwas fehl, fällt der Aufrufer auf die Live-Abfrage zurück —
    // langsamer, aber nie falsch.
    console.error('[partsSummary]', e.message);
    return false;
  }
}

/** Ein Nachzug je Prozess: Die Konten eines Haushalts fragen gleichzeitig. */
let _nachzug: ReturnType<typeof zieheKatalogNach> | null = null;
function katalogEinmalNachziehen() {
  _nachzug ??= zieheKatalogNach().finally(() => { _nachzug = null; });
  return _nachzug;
}

/** Ab so vielen geänderten Nummern auf einmal (CSV-Katalogabgleich) baut jedes Konto neu. */
const KATALOG_EINZELN_BIS = 5000;

/**
 * Offene Katalogänderungen (Migration 0079) in die Zusammenfassungen ziehen:
 * je Konto nur die Gruppen, die eine geänderte Nummer enthalten — vorher wie
 * nachher, denn eine neue BrickLink-Zuordnung verschiebt ein Teil in eine
 * andere Gruppe. Konten ohne Zusammenfassung bleiben unberührt.
 * @returns null, wenn ein anderer Prozess gerade nachzieht
 */
export async function zieheKatalogNach(): Promise<{ konten: number; gruppen: number } | null> {
  return db.transaction(async (tx) => {
    if (!(await repo.sperreKatalogNachzug(tx))) return null;
    const nummern = await repo.holeOffeneNummern(tx);
    if (!nummern.length) return { konten: 0, gruppen: 0 };
    if (nummern.length > KATALOG_EINZELN_BIS) return { konten: await repo.verwirfAlleStaende(tx), gruppen: -1 };
    const betroffen = await repo.betroffeneGruppen(tx, nummern);
    const jeKonto = new Map<number, string[]>();
    for (const b of betroffen) jeKonto.set(b.user_id, [...(jeKonto.get(b.user_id) ?? []), b.part_key]);
    for (const [uid, gruppen] of jeKonto) {
      // Dieselbe Sperre wie rebuild(): Ein laufender Neuaufbau dieses Kontos
      // wird abgewartet, damit er nicht mit älterem Katalog überschreibt.
      await repo.warteAufKonto(tx, uid);
      await repo.baueGruppenNeu(tx, uid, gruppen);
    }
    return { konten: jeKonto.size, gruppen: betroffen.length };
  });
}

/**
 * Erzwingt einen Neuaufbau und wartet darauf. Für Stellen, die anschliessend
 * garantiert aktuelle Zahlen brauchen (z. B. am Ende eines CSV-Imports).
 */
export async function rebuildNow(userId: number): Promise<void> {
  const running = _rebuilding.get(userId);
  if (running) return running;
  const v = await currentVersion(userId);
  const p = rebuild(userId, v).finally(() => { _rebuilding.delete(userId); });
  _rebuilding.set(userId, p);
  return p;
}
