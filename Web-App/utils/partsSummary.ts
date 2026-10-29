/**
 * Vorberechnete Teile-Zusammenfassung.
 * Ausführlich: docs/begruendungen/utils/partsSummary.ts.md#abschnitt
 */
import { mengeJoin, mengeAus } from './bestandsmenge';
import { blJoin, blNummerSql } from './blZuordnung';
import { teilmengeJoin, teilmengeAus } from './bestandsmenge';
import * as db from '../db/database';


/** Stand der Rohdaten dieses Kontos und des gemeinsamen Katalogs. */
async function currentVersion(userId: number): Promise<{ v: number; katalog: number }> {
  const r = await db.get(
    `SELECT (SELECT v FROM parts_version_user WHERE user_id = $1) AS v,
            (SELECT v FROM parts_katalog_stand WHERE id = 1) AS katalog`, [userId]);
  return { v: parseInt(r?.v) || 0, katalog: parseInt(r?.katalog) || 0 };
}

/** Baut die Zusammenfassung eines Nutzers neu auf. */
export async function rebuild(userId: number, version?: { v: number; katalog: number }): Promise<void> {
  const stand = version ?? await currentVersion(userId);
  // Ob DIESER Aufruf gebaut hat. Der Block unten verlaesst die Transaktion
  // vorzeitig, wenn ein anderer Arbeiter die Sperre haelt — dann hat hier
  // nichts geschrieben, und nachzupflegen waere 240 ms fuer nichts.
  let gebaut = false;
  await db.transaction(async (tx: any) => {
    // Sperre über die Datenbank, nicht nur über die In-Memory-Map
    // (_rebuilding) weiter unten.
    // Ausführlich: docs/begruendungen/utils/partsSummary.ts.md#rebuild-lock
    const lock = await tx.get('SELECT pg_try_advisory_xact_lock($1, $2) AS ok',
      [require('./lockNamespaces').LOCKS.TEILE_SUMMARY, userId]);
    if (!lock?.ok) {
      // Ein anderer Worker baut gerade für denselben Nutzer — nichts tun,
      // dessen Ergebnis gilt gleich mit. Kein Fehler, kein Retry nötig.
      return;
    }

    await tx.run('DELETE FROM parts_summary WHERE user_id = $1', [userId]);
    await tx.run(`
      INSERT INTO parts_summary (user_id, part_key, color_id, part_number, bl_part_number,
        part_name, color_name, color_hex, category_name, image_url, image_local,
        is_spare, total_quantity, in_sets, storage)
      SELECT p.user_id,
             -- Der Gruppierungsschluessel ist die BrickLink-Nummer, soweit es
             -- eine abweichende gibt. Sie stand bis Migration 0037 als
             -- Spalte bl_part_number an der Bestandszeile — je Konto,
             -- nachkopiert aus rb_bl_mapping. Jetzt kommt sie aus
             -- bl_zuordnung, einmal je Teil (utils/blZuordnung.ts).
             -- (Keine Gegenstriche um den Spaltennamen: Der Kommentar steht
             -- in einem Template-Literal, und ein Gegenstrich beendet es.)
             ${blNummerSql('p.part_number')},
             p.color_id,
             MIN(p.part_number), MIN(${blNummerSql('p.part_number')}),
             -- Beschreibung aus den Katalogen (Migration 0034): Name und
             -- Kategorie haengen am Teil, Farbbezeichnung und Bild an der
             -- Farbe. In parts stand beides je Konto neu.
             MIN(pc.part_name), MIN(pcc.color_name), MIN(pcc.color_hex), MIN(pc.category_name),
             MIN(pcc.image_url), MIN(pcc.image_local),
             -- is_spare gehoert zur TEILELISTE eines Sets, nicht zum Teil:
             -- derselbe Stein ist in einem Set Ersatzteil und im naechsten
             -- Pflichtteil. MAX() wie vorher, weil die Gruppe mehrere Sets
             -- zusammenfasst; je (Set, Teil, Farbe) ist der Wert eindeutig
             -- (Primaerschluessel von set_parts_catalog).
             MAX(COALESCE(tm_k.is_spare, 0)),
             -- Der zweite Faktor ist die Zahl der Exemplare DES SETS. Hier
             -- stand COALESCE(s.quantity, 1); die Spalte ist mit Migration
             -- 0036 weg. Die gruppierte Form (mengeJoin) und nicht die
             -- Unterabfrage, weil dieser Aufbau ueber 171'000 Teilezeilen
             -- laeuft — eine Unterabfrage je Zeile waeren 171'000
             -- Indexzugriffe statt EINER Gruppierung plus Hash-Join.
             -- Der erste Faktor ist die Stückzahl der Bestandszeile. Hier
             -- stand p.quantity; Migration 0038 hat die Spalte geloescht.
             SUM(${teilmengeAus('p', 'part')} * ${mengeAus('sm', 1)}),
             STRING_AGG(DISTINCT p.set_number, ','),
             -- Lagerort: STRING_AGG statt MIN, wie in der Live-Abfrage
             -- (utils/handlers/parts.ts). Dieselbe Gruppe fasst dasselbe Teil
             -- aus mehreren Sets zusammen, und die koennen in verschiedenen
             -- Kisten liegen. MIN() zeigte eine davon und verschwiege die
             -- andere — so, dass es wie eine vollstaendige Antwort aussieht.
             -- Der Name kommt aus dem Vorrat (Migration 0031: die Zeile
             -- traegt eine ID). Die Spalte HIER bleibt Text, und das ist kein
             -- Rueckfall: Sie ist ein berechnetes Etikett ueber mehrere
             -- Zeilen, kein Verweis — ein einzelner koennte „Kiste 3,
             -- Regal A" gar nicht ausdruecken.
             NULLIF(STRING_AGG(DISTINCT lo.name, ', '), '')
        FROM parts p
        ${mengeJoin('p', 'sm', '= $1')}
        ${teilmengeJoin('p', 'part', 'tm', '= $1')}
        ${blJoin('p.part_number', 'part')}
        LEFT JOIN storage_locations lo ON lo.id = p.storage_id
        LEFT JOIN part_catalog pc ON pc.part_number = p.part_number
        LEFT JOIN part_color_catalog pcc ON pcc.part_number = p.part_number
                                        AND pcc.color_id    = p.color_id
       WHERE p.user_id = $1 AND COALESCE(p.source, 'set') <> 'manual'
       GROUP BY p.user_id, ${blNummerSql('p.part_number')}, p.color_id`,
      [userId]);
    await tx.run(`
      INSERT INTO parts_summary_state (user_id, built_version, katalog_stand, built_at)
      VALUES ($1, $2, $3, NOW())
      ON CONFLICT (user_id) DO UPDATE SET built_version = $2, katalog_stand = $3, built_at = NOW()`,
      [userId, stand.v, stand.katalog]);
    gebaut = true;
  });

  // Neuaufbau = Masseneinfügen: Ohne frische Statistik wählt der Planer den
  // falschen Index (utils/tabellePflegen.ts). Höchstens alle zehn Minuten,
  // weil ANALYZE die Tabelle aller Konten vermisst. VACUUM entfällt, seit die
  // GIN-Indizes keine Warteliste führen (Migration 0054).
  if (gebaut && Date.now() - _letzteAnalyse > 10 * 60_000) {
    _letzteAnalyse = Date.now();
    await db.exec('ANALYZE parts_summary').catch((e: Error) => console.warn('[partsSummary] ANALYZE:', e.message));
  }
}

/**
 * Stellt sicher, dass die Zusammenfassung aktuell ist.
 * @returns true, wenn sie benutzbar ist
 */
let _letzteAnalyse = 0;

/** Laufende Neuaufbauten je Nutzer — verhindert Mehrfachläufe. */
const _rebuilding = new Map<number, Promise<void>>();

function rebuildInBackground(userId: number, v: { v: number; katalog: number }) {
  if (_rebuilding.has(userId)) return;
  const p = rebuild(userId, v)
    .catch(e => console.error('[partsSummary] Hintergrundaufbau:', e.message))
    .finally(() => { _rebuilding.delete(userId); });
  _rebuilding.set(userId, p);
}

/**
 * Ist die Zusammenfassung für diesen Nutzer benutzbar?
 * Ausführlich: docs/begruendungen/utils/partsSummary.ts.md#ensurefresh
 */
export async function ensureFresh(userId: number | number[], opts?: { strict?: boolean }): Promise<boolean> {
  // Haushalt: je Konto prüfen, alle müssen mitspielen
  // Die Tabelle ist je Konto aufgebaut (Schlüssel user_id, part_key, color_id);
  // gelesen wird sie für den Haushalt mit user_id = ANY(...) und über part_key
  // verdichtet. Frisch ist die Sicht nur, wenn sie es für JEDES beteiligte …
  // Ausführlich: docs/begruendungen/utils/partsSummary.ts.md#ensurefresh-ids
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
      db.get('SELECT built_version, katalog_stand FROM parts_summary_state WHERE user_id = $1', [userId]).catch(() => null),
    ]);
    if (state && parseInt(state.built_version) === v.v && parseInt(state.katalog_stand) === v.katalog) return true;

    rebuildInBackground(userId, v);

    // strict: Nur ein AKTUELLER Stand zählt.
    // Ausführlich: docs/begruendungen/utils/partsSummary.ts.md#ensurefresh-2
    if (opts?.strict) return false;

    // Veraltete Zahlen sind besser als drei Sekunden Wartezeit; gibt es noch
    // gar keinen Stand, muss der Aufrufer live abfragen.
    return !!state;
  } catch (e: any) {
    // Schlägt etwas fehl, fällt der Aufrufer auf die Live-Abfrage zurück —
    // langsamer, aber nie falsch.
    console.error('[partsSummary]', e.message);
    return false;
  }
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
