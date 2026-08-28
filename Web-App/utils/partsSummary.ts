/**
 * Vorberechnete Teile-Zusammenfassung.
 *
 * ── Warum ───────────────────────────────────────────────────────────────────
 * Die Teileansicht gruppiert 171'000 parts-Zeilen (380 Sets) nach
 * COALESCE(bl_part_number, part_number) und color_id. Diese Gruppierung lief
 * bei JEDEM Seitenaufruf komplett neu — auch nach der Umstellung auf
 * Endlos-Scroll, denn LIMIT kann erst nach dem GROUP BY greifen. Gemessen:
 *
 *     Zähler                 100 ms
 *     Seitenabfrage          157 ms   → rund 600 ms pro Scroll-Schritt
 *
 * Aus einer vorberechneten Tabelle mit passendem Index:
 *
 *     Zähler                   7 ms
 *     Seitenabfrage            2 ms
 *
 * Das Ergebnis ändert sich nur, wenn sich Teile oder Set-Mengen ändern — also
 * beim CSV-Import, beim Hinzufügen/Löschen eines Sets und bei manuellen
 * Teilen. Gelesen wird es dagegen bei jedem Scroll-Schritt.
 *
 * ── Warum ein Trigger und keine Aufrufe an den Schreibstellen ───────────────
 * Die naheliegende Variante wäre, an jeder schreibenden Stelle „Zusammenfassung
 * neu bauen" aufzurufen. Genau daran scheitern solche Caches aber: Eine
 * übersehene Stelle liefert still veraltete Daten, und man merkt es erst, wenn
 * jemand sich über falsche Zahlen wundert.
 *
 * Deshalb hängt an `parts` und `sets` ein Statement-Trigger, der einen globalen
 * Zähler hochsetzt. Kein Code-Pfad kann daran vorbei — auch der CSV-Import
 * nicht, der mit gebündelten INSERTs arbeitet. Statement-Ebene statt Zeilenebene
 * ist wichtig: Ein Import mit 171'000 Zeilen löst so EINEN Bump aus, nicht
 * 171'000.
 *
 * Beim Lesen wird verglichen: Ist der globale Zähler grösser als der Stand, mit
 * dem die Zusammenfassung des Nutzers gebaut wurde, wird sie neu aufgebaut
 * (596 ms) — sonst direkt gelesen. Der Preis dafür ist, dass die Schreiboperation
 * eines Nutzers die Zusammenfassungen aller anderen entwertet. Bei einer
 * selbst gehosteten Installation mit wenigen Konten ist das der richtige Tausch
 * gegen die Sicherheit, nie veraltete Zahlen zu zeigen.
 */
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

  // ── Ein Zähler JE KONTO ─────────────────────────────────────────────────
  //
  // Hier stand ein einziger globaler Zähler (Tabelle parts_version, eine
  // Zeile). Er war einfach, hatte aber einen Preis, der im Haushalt spürbar
  // wird: JEDE Änderung IRGENDEINES Kontos entwertete die Zusammenfassung
  // ALLER. Trägt ein Kind ein Teil nach, gilt die Zusammenfassung der Eltern
  // als veraltet — und die Kennzahlen (ensureFresh mit strict) weichen so
  // lange auf die Live-Abfrage aus, bis der Neuaufbau durch ist. Gemessen an
  // 800 Sets / 60'000 Teilen: rund 300 ms Neuaufbau, ausgelöst durch eine
  // Änderung, die mit diesen Daten nichts zu tun hatte.
  //
  // Jetzt zählt jede Zeile für ihr eigenes Konto. Die Zusammenfassung eines
  // Kontos wird nur noch entwertet, wenn dessen eigene Daten sich ändern.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS parts_version_user (
      user_id INTEGER PRIMARY KEY,
      v       BIGINT NOT NULL DEFAULT 0
    )`);

  // ── Warum drei Trigger statt einem ──────────────────────────────────────
  //
  // Um zu wissen, WESSEN Daten sich geändert haben, braucht der Trigger die
  // betroffenen Zeilen — auf Statement-Ebene sind das die Übergangstabellen
  // (REFERENCING … TABLE). Die gibt es aber nur passend zur Operation: beim
  // INSERT nur NEW, beim DELETE nur OLD. Ein gemeinsamer Trigger für alle drei
  // Operationen kann sie deshalb nicht deklarieren — daher je einer.
  //
  // FOR EACH STATEMENT bleibt: Ein CSV-Import mit gebündelten INSERTs kostet
  // einen Zähler-Update je Anweisung, nicht 171'000.
  await pool.query(`
    CREATE OR REPLACE FUNCTION bump_parts_version_ins() RETURNS trigger AS $$
    BEGIN
      INSERT INTO parts_version_user (user_id, v)
      SELECT DISTINCT user_id, 1 FROM neu WHERE user_id IS NOT NULL
      ON CONFLICT (user_id) DO UPDATE SET v = parts_version_user.v + 1;
      RETURN NULL;
    END $$ LANGUAGE plpgsql`);
  await pool.query(`
    CREATE OR REPLACE FUNCTION bump_parts_version_del() RETURNS trigger AS $$
    BEGIN
      INSERT INTO parts_version_user (user_id, v)
      SELECT DISTINCT user_id, 1 FROM alt WHERE user_id IS NOT NULL
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
      ) x WHERE user_id IS NOT NULL
      ON CONFLICT (user_id) DO UPDATE SET v = parts_version_user.v + 1;
      RETURN NULL;
    END $$ LANGUAGE plpgsql`);

  for (const tbl of ['parts', 'sets']) {
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
  await db.transaction(async (tx) => {
    // Sperre über die Datenbank, nicht nur über die In-Memory-Map
    // (_rebuilding) weiter unten.
    //
    // Der Server läuft im Cluster-Modus mit mehreren Worker-Prozessen
    // (server.ts, cluster.fork()) — jeder Worker hat seine EIGENE
    // _rebuilding-Map, die nur INNERHALB desselben Prozesses vor
    // Mehrfachläufen schützt. Fragen zwei Worker nahezu gleichzeitig für
    // DENSELBEN Nutzer an (z. B. Webapp und Android-App, oder mehrere
    // gleichzeitige Tabs), konnte jeder Worker unabhängig DELETE+INSERT
    // ausführen. Unter READ COMMITTED blockiert der DELETE des zweiten
    // Workers auf den Zeilen-Sperren des ersten; sobald der erste committet,
    // sieht der zweite dessen bereits committete Zeilen NICHT mehr als Teil
    // seines ursprünglichen Scans (die neuen Zeilen kamen NACH Beginn seines
    // DELETE hinzu) — er löscht sie nicht mit, versucht aber trotzdem, seine
    // eigenen (identischen) Zeilen einzufügen. Genau das verletzt den
    // Primärschlüssel: "duplicate key value violates unique constraint
    // parts_summary_pkey".
    //
    // pg_try_advisory_xact_lock ist prozessübergreifend (liegt in der
    // Datenbank, nicht im Node-Prozess) und wird beim COMMIT/ROLLBACK der
    // Transaktion automatisch freigegeben. Namensraum 77, um nicht mit den
    // bestehenden Sperren in server.ts (99999999), jobs/partsCatalogEnrich.ts
    // (42) oder clients/brickset.ts (11223344) zu kollidieren.
    const lock = await tx.get('SELECT pg_try_advisory_xact_lock(77, $1) AS ok', [userId]);
    if (!lock?.ok) {
      // Ein anderer Worker baut gerade für denselben Nutzer — nichts tun,
      // dessen Ergebnis gilt gleich mit. Kein Fehler, kein Retry nötig.
      return;
    }

    await tx.run('DELETE FROM parts_summary WHERE user_id = $1', [userId]);
    await tx.run(`
      INSERT INTO parts_summary (user_id, part_key, color_id, part_number, bl_part_number,
        part_name, color_name, color_hex, category_name, image_url, image_local,
        is_spare, total_quantity, in_sets)
      SELECT p.user_id,
             COALESCE(p.bl_part_number, p.part_number),
             p.color_id,
             MIN(p.part_number), MIN(p.bl_part_number),
             MIN(p.part_name), MIN(p.color_name), MIN(p.color_hex), MIN(p.category_name),
             MIN(p.image_url), MIN(p.image_local),
             MAX(COALESCE(p.is_spare, 0)),
             SUM(p.quantity * COALESCE(s.quantity, 1)),
             STRING_AGG(DISTINCT p.set_number, ',')
        FROM parts p
        LEFT JOIN sets s ON s.user_id = p.user_id AND s.set_number = p.set_number
       WHERE p.user_id = $1 AND COALESCE(p.source, 'set') <> 'manual'
       GROUP BY p.user_id, COALESCE(p.bl_part_number, p.part_number), p.color_id`,
      [userId]);
    await tx.run(`
      INSERT INTO parts_summary_state (user_id, built_version, built_at)
      VALUES ($1, $2, NOW())
      ON CONFLICT (user_id) DO UPDATE SET built_version = $2, built_at = NOW()`,
      [userId, v]);
  });
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
 *
 * WICHTIG: Diese Funktion baut NICHT mehr im Request auf. Vorher tat sie genau
 * das — und weil ein Trigger die Version bei jeder Änderung an `parts` hochsetzt
 * (CSV-Import, Set hinzufügen, Katalog-Anreicherung), zahlte der nächste Aufruf
 * des Teile-Reiters den vollen Neuaufbau. Gemessen an 380 Sets waren das rund
 * drei Sekunden, in denen die Kachelwand leer blieb. Dass manuell erfasste Teile
 * sofort erschienen, passte dazu: die laufen über eine eigene Abfrage ohne
 * Zusammenfassung.
 *
 * Jetzt gilt:
 *   • aktuell            → true, sofort
 *   • veraltet, aber da  → true, sofort MIT den alten Zahlen; der Neuaufbau
 *                          läuft im Hintergrund und greift ab der nächsten
 *                          Anfrage. Die Abweichung betrifft höchstens einen
 *                          Seitenaufruf direkt nach einer Änderung.
 *   • gar nicht vorhanden→ false; der Aufrufer nimmt die Live-Abfrage (langsamer,
 *                          aber korrekt), der Aufbau läuft im Hintergrund an.
 */
export async function ensureFresh(userId: number | number[], opts?: { strict?: boolean }): Promise<boolean> {
  // ── Haushalt: je Konto prüfen, alle müssen mitspielen ─────────────────────
  //
  // Die Tabelle ist je Konto aufgebaut (Schlüssel user_id, part_key, color_id);
  // gelesen wird sie für den Haushalt mit user_id = ANY(...) und über part_key
  // verdichtet. Frisch ist die Sicht nur, wenn sie es für JEDES beteiligte
  // Konto ist — „zwei von drei sind aktuell" ergäbe eine Summe aus zwei
  // frischen und einem alten Bestand, und der Zahl sieht man das nicht an.
  //
  // Fehlende Konten werden im Hintergrund aufgebaut; bis dahin nimmt der
  // Aufrufer den Live-Pfad.
  const ids = Array.isArray(userId) ? userId : [userId];
  if (ids.length > 1) {
    const results = await Promise.all(ids.map(id => ensureFresh(id, opts)));
    return results.every(Boolean);
  }
  userId = ids[0];
  try {
    const [v, state] = await Promise.all([
      currentVersion(userId as number),
      db.get('SELECT built_version FROM parts_summary_state WHERE user_id = $1', [userId]).catch(() => null),
    ]);
    if (state && parseInt(state.built_version) === v) return true;

    rebuildInBackground(userId, v);

    // strict: Nur ein AKTUELLER Stand zählt.
    //
    // Für Listen sind veraltete Zahlen unkritisch — sie stimmen einen
    // Seitenaufruf später. Für Kennzahlen ist das anders: Webapp und
    // Android-App fragen dieselbe Statistik über zwei Endpunkte ab, und
    // während eines Neuaufbaus las der eine aus der Zusammenfassung und der
    // andere live. Die Paritätsprüfung hat genau das aufgedeckt. Mit strict
    // weichen beide gemeinsam auf die Live-Abfrage aus, bis der Neuaufbau
    // durch ist — kurz langsamer, dafür überall dieselbe Zahl.
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
