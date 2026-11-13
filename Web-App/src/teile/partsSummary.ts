/** Vorberechnet, weil die Live-Abfrage über alle Set-Teile eines Haushalts
 * Sekunden braucht. */
import { fehlertext } from '../infra/fehler';
import { imSystemkontext } from '../infra/kontoKontext';
import * as repo from './repository/teileZusammenfassung';
import type { TeileKontext } from './kontext';

const currentVersion = (k: TeileKontext, userId: number) => k.teileZusammenfassung.rohstand(userId);

export async function rebuild(k: TeileKontext, userId: number, version?: { v: number }): Promise<void> {
  const stand = version ?? (await currentVersion(k, userId));
  // Ob DIESER Aufruf gebaut hat: Hält ein anderer die Sperre, gibt es nichts
  // nachzupflegen.
  let gebaut = false;
  await k.transaktion(async t => {
    // Sperre über die Datenbank, nicht nur über _rebuilding: Mehrere Prozesse.
    if (!(await repo.sperreKonto(t.db, userId))) {
      return;
    }
    await repo.baueNeu(t.db, userId, stand.v);
    gebaut = true;
  });

  // Ohne frische Statistik wählt der Planer nach dem Masseneinfügen den falschen
  // Index. Höchstens alle zehn Minuten, weil ANALYZE die Tabelle aller Konten vermisst.
  if (gebaut && Date.now() - _letzteAnalyse > 10 * 60_000) {
    _letzteAnalyse = Date.now();
    await k.teileZusammenfassung.analysiere().catch((e: Error) => console.warn('[partsSummary] ANALYZE:', e.message));
  }
}

let _letzteAnalyse = 0;

const _rebuilding = new Map<number, Promise<void>>();

function rebuildInBackground(k: TeileKontext, userId: number, v: { v: number }) {
  if (_rebuilding.has(userId)) return;
  const p = rebuild(k, userId, v)
    .catch(e => console.error('[partsSummary] Hintergrundaufbau:', e.message))
    .finally(() => {
      _rebuilding.delete(userId);
    });
  _rebuilding.set(userId, p);
}

// Baut nicht im Request auf: Der Neuaufbau kostete den Teile-Reiter Sekunden.
export async function ensureFresh(
  k: TeileKontext,
  userId: number | number[],
  opts?: { strict?: boolean },
): Promise<boolean> {
  // Frisch ist die Haushaltssicht nur, wenn sie es für JEDES beteiligte Konto ist.
  const ids = Array.isArray(userId) ? userId : [userId];
  if (ids.length > 1) {
    const results = await Promise.all(ids.map(id => ensureFresh(k, id, opts)));
    return results.every(Boolean);
  }
  userId = ids[0] ?? 0;
  try {
    const [v, state] = await Promise.all([
      currentVersion(k, userId as number),
      k.teileZusammenfassung.gebauterStand(userId),
    ]);
    // Hält ein anderer Prozess die Sperre, ist der Stand nicht gesichert.
    const katalogNachgezogen = !v.katalogOffen || (await katalogEinmalNachziehen(k)) !== null;
    if (state === v.v && katalogNachgezogen) return true;

    rebuildInBackground(k, userId, v);

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
function katalogEinmalNachziehen(k: TeileKontext) {
  _nachzug ??= zieheKatalogNach(k).finally(() => {
    _nachzug = null;
  });
  return _nachzug;
}

const KATALOG_EINZELN_BIS = 5000;

/** Je Konto nur die Gruppen mit einer geänderten Nummer — vorher wie nachher,
 * denn eine neue BL-Zuordnung verschiebt ein Teil in eine andere Gruppe. Im
 * Systemrahmen: Die Warteschlange ist global, und wer sie leert, muss die Gruppen
 * aller Konten nachziehen, nicht nur die des Kontos, dessen Anfrage es auslöst.
 * @returns null, wenn ein anderer Prozess gerade nachzieht */
export function zieheKatalogNach(k: TeileKontext): Promise<{ konten: number; gruppen: number } | null> {
  return imSystemkontext('katalog-nachzug', () => zieheKatalogNachImRahmen(k));
}

async function zieheKatalogNachImRahmen(k: TeileKontext): Promise<{ konten: number; gruppen: number } | null> {
  return k.transaktion(async t => {
    if (!(await repo.sperreKatalogNachzug(t.db))) return null;
    const nummern = await repo.holeOffeneNummern(t.db);
    if (!nummern.length) return { konten: 0, gruppen: 0 };
    if (nummern.length > KATALOG_EINZELN_BIS) return { konten: await repo.verwirfAlleStaende(t.db), gruppen: -1 };
    const betroffen = await repo.betroffeneGruppen(t.db, nummern);
    const jeKonto = new Map<number, string[]>();
    for (const b of betroffen) jeKonto.set(b.user_id, [...(jeKonto.get(b.user_id) ?? []), b.part_key]);
    for (const [uid, gruppen] of jeKonto) {
      // Ein laufender Neuaufbau wird abgewartet, damit er nicht mit älterem Katalog
      // überschreibt.
      await repo.warteAufKonto(t.db, uid);
      await repo.baueGruppenNeu(t.db, uid, gruppen);
    }
    return { konten: jeKonto.size, gruppen: betroffen.length };
  });
}

/** Für Stellen, die danach garantiert aktuelle Zahlen brauchen (Ende eines CSV-Imports). */
export async function rebuildNow(k: TeileKontext, userId: number): Promise<void> {
  const running = _rebuilding.get(userId);
  if (running) return running;
  const v = await currentVersion(k, userId);
  const p = rebuild(k, userId, v).finally(() => {
    _rebuilding.delete(userId);
  });
  _rebuilding.set(userId, p);
  return p;
}
