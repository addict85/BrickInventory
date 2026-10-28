/**
 * Vorberechnete Teile-Zusammenfassung.
 * Ausführlich: docs/begruendungen/utils/partsSummary.ts.md#abschnitt
 */
import { pflegeTabelle } from './tabellePflegen';
import { mengeJoin, mengeAus } from './bestandsmenge';
import { blJoin, blNummerSql } from './blZuordnung';
import { teilmengeJoin, teilmengeAus } from './bestandsmenge';
import * as db from '../db/database';

/** Legt Tabellen und Trigger an. Aus initSchema() aufgerufen, idempotent. */
export async function initPartsSummary(pool: any) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS parts_summary (
      user_id        INTEGER NOT NULL,
      part_key       TEXT    NOT NULL,
      color_id       INTEGER NOT NULL,
      part_number    TEXT,
      bl_part_number TEXT,
      part_name      TEXT,
      color_name     TEXT,
      color_hex      TEXT,
      category_name  TEXT,
      image_url      TEXT,
      image_local    TEXT,
      is_spare       INTEGER DEFAULT 0,
      total_quantity BIGINT  DEFAULT 0,
      in_sets        TEXT,
      PRIMARY KEY (user_id, part_key, color_id)
    )`);

  // Nachtraeglich hinzugekommene Spalten: Die Tabelle entsteht per
  // CREATE TABLE IF NOT EXISTS und wuerde auf einer bestehenden Datenbank
  // sonst still ohne die neue Spalte weiterlaufen — der Neuaufbau schluege
  // dann bei jedem Lauf fehl, und die Ansicht faellt lautlos auf die
  // Live-Abfrage zurueck.
  await pool.query(`ALTER TABLE parts_summary ADD COLUMN IF NOT EXISTS storage TEXT`);

  // Genau die Sortierung der Ansicht — damit ist die Seitenabfrage ein
  // Index-Scan mit LIMIT statt einer Sortierung über alle Gruppen.
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_parts_summary_sort
                    ON parts_summary(user_id, color_name, part_name)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_parts_summary_color
                    ON parts_summary(user_id, color_id)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_parts_summary_cat
                    ON parts_summary(user_id, category_name)`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS parts_summary_state (
      user_id       INTEGER PRIMARY KEY,
      built_version BIGINT  NOT NULL DEFAULT 0,
      built_at      TIMESTAMPTZ DEFAULT NOW()
    )`);

  // Ein Zähler JE KONTO
  // Jetzt zählt jede Zeile für ihr eigenes Konto. Die Zusammenfassung eines
  // Kontos wird nur noch entwertet, wenn dessen eigene Daten sich ändern.
  // Ausführlich: docs/begruendungen/utils/partsSummary.ts.md#initpartssummary
  await pool.query(`
    CREATE TABLE IF NOT EXISTS parts_version_user (
      user_id INTEGER PRIMARY KEY,
      v       BIGINT NOT NULL DEFAULT 0
    )`);

  // Warum drei Trigger statt einem
  // Um zu wissen, WESSEN Daten sich geändert haben, braucht der Trigger die
  // betroffenen Zeilen — auf Statement-Ebene sind das die Übergangstabellen
  // (REFERENCING … TABLE). Die gibt es aber nur passend zur Operation: beim …
  // Ausführlich: docs/begruendungen/utils/partsSummary.ts.md#initpartssummary-2
  await pool.query(`
    CREATE OR REPLACE FUNCTION bump_parts_version_ins() RETURNS trigger AS $$
    BEGIN
      INSERT INTO parts_version_user (user_id, v)
      SELECT DISTINCT user_id, 1 FROM neu WHERE user_id IS NOT NULL AND user_id IN (SELECT id FROM users)
      ON CONFLICT (user_id) DO UPDATE SET v = parts_version_user.v + 1;
      RETURN NULL;
    END $$ LANGUAGE plpgsql`);
  // Nur für bestehende Konten: Beim Löschen eines Kontos laufen diese Trigger
  // im Cascade, und der Fremdschlüssel auf users würde den Zähler ablehnen.
  await pool.query(`
    CREATE OR REPLACE FUNCTION bump_parts_version_del() RETURNS trigger AS $$
    BEGIN
      INSERT INTO parts_version_user (user_id, v)
      SELECT DISTINCT user_id, 1 FROM alt WHERE user_id IS NOT NULL AND user_id IN (SELECT id FROM users)
      ON CONFLICT (user_id) DO UPDATE SET v = parts_version_user.v + 1;
      RETURN NULL;
    END $$ LANGUAGE plpgsql`);
  // UPDATE: beide Seiten. Wandert eine Zeile zwischen Konten (Haushalt), sind
  // ZWEI Zusammenfassungen veraltet — die des Absenders und die des Ziels.
  await pool.query(`
    CREATE OR REPLACE FUNCTION bump_parts_version_upd() RETURNS trigger AS $$
    BEGIN
      INSERT INTO parts_version_user (user_id, v)
      SELECT DISTINCT user_id, 1 FROM (
        SELECT user_id FROM alt UNION SELECT user_id FROM neu
      ) x WHERE user_id IS NOT NULL AND user_id IN (SELECT id FROM users)
      ON CONFLICT (user_id) DO UPDATE SET v = parts_version_user.v + 1;
      RETURN NULL;
    END $$ LANGUAGE plpgsql`);

  // Warum `set_acquisitions` dazugehoert
  // Die Zusammenfassung speichert `total_quantity` = Teilemenge je Set x Zahl
  // der Exemplare DES SETS. Dieser zweite Faktor stand bis Migration 0036 in
  // `sets.quantity` — eine Mengenaenderung war also eine Aenderung an `sets` …
  // Ausführlich: docs/begruendungen/utils/partsSummary.ts.md#initpartssummary-3
  for (const tbl of ['parts', 'sets', 'set_acquisitions']) {
    // Der alte Sammel-Trigger muss weg, sonst zählt er weiter mit.
    await pool.query(`DROP TRIGGER IF EXISTS trg_bump_parts_version ON ${tbl}`);
    for (const [suffix, op, ref] of [
      ['ins', 'INSERT', 'REFERENCING NEW TABLE AS neu'],
      ['del', 'DELETE', 'REFERENCING OLD TABLE AS alt'],
      ['upd', 'UPDATE', 'REFERENCING OLD TABLE AS alt NEW TABLE AS neu'],
    ]) {
      await pool.query(`DROP TRIGGER IF EXISTS trg_bump_parts_version_${suffix} ON ${tbl}`);
      await pool.query(`
        CREATE TRIGGER trg_bump_parts_version_${suffix}
        AFTER ${op} ON ${tbl}
        ${ref}
        FOR EACH STATEMENT EXECUTE FUNCTION bump_parts_version_${suffix}()`);
    }
  }

  // Die alte Tabelle bleibt vorerst stehen (kein Datenverlust, kein Zwang zur
  // Migration): Beim ersten Lesen nach dem Update stimmt der neue Zähler nicht
  // mit dem gespeicherten Stand überein, und jede Zusammenfassung wird genau
  // einmal neu gebaut. Danach ist der Zustand konsistent.
  await pool.query(`DROP FUNCTION IF EXISTS bump_parts_version()`);
}

/** Aktueller Stand der Rohdaten DIESES Kontos. Ohne Zeile: 0 (nie geschrieben). */
async function currentVersion(userId: number): Promise<number> {
  const r = await db.get('SELECT v FROM parts_version_user WHERE user_id = $1', [userId]).catch(() => null);
  return parseInt(r?.v) || 0;
}

/** Baut die Zusammenfassung eines Nutzers neu auf. */
export async function rebuild(userId: number, version?: number): Promise<void> {
  const v = version ?? await currentVersion(userId);
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
             MAX(COALESCE(spc.is_spare, 0)),
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
        ${mengeJoin('p')}
        ${teilmengeJoin('p', 'part')}
        ${blJoin('p.part_number', 'part')}
        LEFT JOIN storage_locations lo ON lo.id = p.storage_id
        LEFT JOIN part_catalog pc ON pc.part_number = p.part_number
        LEFT JOIN part_color_catalog pcc ON pcc.part_number = p.part_number
                                        AND pcc.color_id    = p.color_id
        LEFT JOIN set_parts_catalog spc ON spc.set_number  = p.set_number
                                       AND spc.part_number = p.part_number
                                       AND spc.color_id    = p.color_id
       WHERE p.user_id = $1 AND COALESCE(p.source, 'set') <> 'manual'
       GROUP BY p.user_id, ${blNummerSql('p.part_number')}, p.color_id`,
      [userId]);
    await tx.run(`
      INSERT INTO parts_summary_state (user_id, built_version, built_at)
      VALUES ($1, $2, NOW())
      ON CONFLICT (user_id) DO UPDATE SET built_version = $2, built_at = NOW()`,
      [userId, v]);
    gebaut = true;
  });

  // DELETE + INSERT aller Zeilen eines Nutzers ist ein Masseneinfuegen. Gemessen
  // an 72 000 Zeilen: Die Suche nach einem seltenen Begriff dauert danach
  // 9,5 ms und nach dem Auffrischen 0,2 ms; ohne Statistik sogar 94 ms, weil
  // der Planer dann den falschen Index nimmt. Zahlen und Begruendung in
  // utils/tabellePflegen.ts.
  //
  // NACH der Transaktion, nicht darin: VACUUM ist in einer Transaktion nicht
  // erlaubt. Und nur wenn gebaut wurde — siehe oben.
  if (gebaut) await pflegeTabelle((sql: string) => db.exec(sql), 'parts_summary');
}

/**
 * Stellt sicher, dass die Zusammenfassung aktuell ist.
 * @returns true, wenn sie benutzbar ist
 */
/** Laufende Neuaufbauten je Nutzer — verhindert Mehrfachläufe. */
const _rebuilding = new Map<number, Promise<void>>();

function rebuildInBackground(userId: number, v: number) {
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
      db.get('SELECT built_version FROM parts_summary_state WHERE user_id = $1', [userId]).catch(() => null),
    ]);
    if (state && parseInt(state.built_version) === v) return true;

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
