/** Vorberechnet, weil die Live-Abfrage über alle Set-Teile eines Haushalts
 * Sekunden braucht. */
import { meldeUndLiefere, fehlertext } from '../infra/fehler';
import * as db from '../../db/database';
import * as repo from './repository/teileZusammenfassung';

const currentVersion = repo.rohstand;

export async function rebuild(userId: number, version?: { v: number }): Promise<void> {
  const stand = version ?? await currentVersion(userId);
  // Ob DIESER Aufruf gebaut hat: Hält ein anderer die Sperre, gibt es nichts
  // nachzupflegen.
  let gebaut = false;
  await db.transaction(async (tx) => {
    // Sperre über die Datenbank, nicht nur über _rebuilding: Mehrere Prozesse.
    if (!(await repo.sperreKonto(tx, userId))) {
      return;
    }
    await repo.baueNeu(tx, userId, stand.v);
    gebaut = true;
  });

  // Ohne frische Statistik wählt der Planer nach dem Masseneinfügen den falschen
  // Index. Höchstens alle zehn Minuten, weil ANALYZE die Tabelle aller Konten vermisst.
  if (gebaut && Date.now() - _letzteAnalyse > 10 * 60_000) {
    _letzteAnalyse = Date.now();
    await repo.analysiere().catch((e: Error) => console.warn('[partsSummary] ANALYZE:', e.message));
  }
}

let _letzteAnalyse = 0;

const _rebuilding = new Map<number, Promise<void>>();

function rebuildInBackground(userId: number, v: { v: number }) {
  if (_rebuilding.has(userId)) return;
  const p = rebuild(userId, v)
    .catch(e => console.error('[partsSummary] Hintergrundaufbau:', e.message))
    .finally(() => { _rebuilding.delete(userId); });
  _rebuilding.set(userId, p);
}

// Baut nicht im Request auf: Der Neuaufbau kostete den Teile-Reiter Sekunden.
export async function ensureFresh(userId: number | number[], opts?: { strict?: boolean }): Promise<boolean> {
  // Frisch ist die Haushaltssicht nur, wenn sie es für JEDES beteiligte Konto ist.
  const ids = Array.isArray(userId) ? userId : [userId];
  if (ids.length > 1) {
    const results = await Promise.all(ids.map(id => ensureFresh(id, opts)));
    return results.every(Boolean);
  }
  userId = ids[0] ?? 0;
  try {
    const [v, state] = await Promise.all([
      currentVersion(userId as number),
      repo.gebauterStand(userId).catch(meldeUndLiefere('teile-zsf:get', null)),
    ]);
    // Hält ein anderer Prozess die Sperre, ist der Stand nicht gesichert.
    const katalogNachgezogen = !v.katalogOffen || (await katalogEinmalNachziehen()) !== null;
    if (state === v.v && katalogNachgezogen) return true;

    rebuildInBackground(userId, v);

    // strict: Nur ein AKTUELLER Stand zählt, damit Kennzahlen überall übereinstimmen.
    if (opts?.strict) return false;

    // Veraltete Zahlen sind besser als drei Sekunden Wartezeit; gibt es noch
    // gar keinen Stand, muss der Aufrufer live abfragen.
    return state !== null;
  } catch (e) {
    // Der Aufrufer fällt auf die Live-Abfrage zurück — langsamer, aber nie falsch.
    console.error('[partsSummary]', fehlertext(e));
    return false;
  }
}

/** Ein Nachzug je Prozess: Die Konten eines Haushalts fragen gleichzeitig. */
let _nachzug: ReturnType<typeof zieheKatalogNach> | null = null;
function katalogEinmalNachziehen() {
  _nachzug ??= zieheKatalogNach().finally(() => { _nachzug = null; });
  return _nachzug;
}

const KATALOG_EINZELN_BIS = 5000;

/** Je Konto nur die Gruppen mit einer geänderten Nummer — vorher wie nachher,
 * denn eine neue BL-Zuordnung verschiebt ein Teil in eine andere Gruppe.
 * @returns null, wenn ein anderer Prozess gerade nachzieht */
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
      // Ein laufender Neuaufbau wird abgewartet, damit er nicht mit älterem Katalog
      // überschreibt.
      await repo.warteAufKonto(tx, uid);
      await repo.baueGruppenNeu(tx, uid, gruppen);
    }
    return { konten: jeKonto.size, gruppen: betroffen.length };
  });
}

/** Für Stellen, die danach garantiert aktuelle Zahlen brauchen (Ende eines CSV-Imports). */
export async function rebuildNow(userId: number): Promise<void> {
  const running = _rebuilding.get(userId);
  if (running) return running;
  const v = await currentVersion(userId);
  const p = rebuild(userId, v).finally(() => { _rebuilding.delete(userId); });
  _rebuilding.set(userId, p);
  return p;
}
