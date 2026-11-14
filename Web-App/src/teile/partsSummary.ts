/** Vorberechnet, weil die Live-Abfrage über alle Set-Teile eines Haushalts
 * Sekunden braucht. */
import { meldeFehler } from '../infra/fehler';
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
  const z = zustand(k);
  if (gebaut && Date.now() - z.letzteAnalyse > 10 * 60_000) {
    z.letzteAnalyse = Date.now();
    await k.teileZusammenfassung.analysiere().catch((e: unknown) => meldeFehler('teile-zusammenfassung:analyse', e));
  }
}

/** Je Zugang: Konto-IDs, Neuaufbauten und Nachzug gehören zu der Datenbank, in der sie laufen. */
const zustand = (k: TeileKontext) =>
  k.faecher.fach('teileZusammenfassung', () => ({
    letzteAnalyse: 0,
    neuaufbau: new Map<number, Promise<void>>(),
    nachzug: null as ReturnType<typeof zieheKatalogNach> | null,
  }));

function rebuildInBackground(k: TeileKontext, userId: number, v: { v: number }) {
  const _rebuilding = zustand(k).neuaufbau;
  if (_rebuilding.has(userId)) return;
  const p = rebuild(k, userId, v)
    .catch((e: unknown) => meldeFehler('teile-zusammenfassung:hintergrund', e))
    .finally(() => {
      _rebuilding.delete(userId);
    });
  _rebuilding.set(userId, p);
}

// Baut nicht im Request auf: Der Neuaufbau kostete den Teile-Reiter Sekunden.
export async function zusammenfassungFrisch(
  k: TeileKontext,
  userId: number | number[],
  opts?: { strict?: boolean },
): Promise<boolean> {
  // Frisch ist die Haushaltssicht nur, wenn sie es für JEDES beteiligte Konto ist.
  const ids = Array.isArray(userId) ? userId : [userId];
  if (ids.length > 1) {
    const results = await Promise.all(ids.map(id => zusammenfassungFrisch(k, id, opts)));
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
    // Ausnahme: false heisst „nicht frisch“; der Aufrufer fragt live, langsamer, aber nie falsch.
    meldeFehler('teile-zusammenfassung:frisch', e);
    return false;
  }
}

/** Ein Nachzug je Zugang: Die Konten eines Haushalts fragen gleichzeitig. */
function katalogEinmalNachziehen(k: TeileKontext) {
  const z = zustand(k);
  z.nachzug ??= zieheKatalogNach(k).finally(() => {
    z.nachzug = null;
  });
  return z.nachzug;
}

const KATALOG_EINZELN_BIS = 5000;

/** Gruppen mit geänderter BL-Nummer, vorher wie nachher. Im Systemrahmen: Die Warteschlange
 * ist global, wer sie leert, zieht alle Konten nach. @returns null, wenn ein anderer nachzieht */
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
  const _rebuilding = zustand(k).neuaufbau;
  const running = _rebuilding.get(userId);
  if (running) return running;
  const v = await currentVersion(k, userId);
  const p = rebuild(k, userId, v).finally(() => {
    _rebuilding.delete(userId);
  });
  _rebuilding.set(userId, p);
  return p;
}
