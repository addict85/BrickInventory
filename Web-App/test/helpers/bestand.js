/**
 * Bestand anlegen und lesen — für Testaufbauten.
 *
 * ── Warum es diese Datei gibt ───────────────────────────────────────────────
 *
 * Bis Migration 0036 stand die Stückzahl eines Sets in `sets.quantity`, und
 * jeder Testaufbau schrieb sie dort hin:
 *
 *     INSERT INTO sets (user_id, set_number, quantity) VALUES ($1,$2,1)
 *
 * GEMESSEN: 65-mal, in 48 Dateien. Die Spalte ist weg (sie lief mit den
 * Erfassungen auseinander — sets.quantity = 10 bei drei Erfassungen mit Summe
 * 7), die Stückzahl steht in `set_acquisitions`. Ein Bestand ist seitdem ZWEI
 * Zeilen: eine in `sets` („dieses Konto hält dieses Set") und eine je Kauf.
 *
 * Diese zwei Zeilen 65-mal hinzuschreiben hiesse: 65 Stellen, die beim
 * nächsten Schnitt wieder einzeln angefasst werden müssen. Hier steht es
 * einmal.
 */

/**
 * „Dieses Konto hält dieses Set, so viele Exemplare."
 *
 * @param db   das Datenbankmodul (db/database.js)
 * @param userId  Konto
 * @param setNumber  Setnummer
 * @param menge  Exemplare. 0 ist erlaubt und heisst „Bestandszeile ohne
 *               Erfassung" — ein gültiger Zustand (etwa nach dem Löschen der
 *               letzten Erfassung über den Mengenregler), und genau der Fall,
 *               auf den die Listen mit 0 antworten müssen.
 * @param opt.preis    Kaufpreis der Erfassung (Standard: keiner)
 * @param opt.zustand  'N' oder 'U' (Standard 'N')
 * @param opt.am       Aufnahmedatum der Erfassung (Standard: jetzt).
 *                     idx_set_acq_tag erlaubt je Konto, Set und TAG nur eine
 *                     Erfassung — mehrere Käufe desselben Sets brauchen also
 *                     verschiedene Tage.
 * @param opt.egalWennDa  true: eine schon vorhandene sets-Zeile ist in Ordnung
 */
async function haeltSet(db, userId, setNumber, menge = 1, opt = {}) {
  await db.run(
    `INSERT INTO sets (user_id, set_number) VALUES ($1,$2)` +
    (opt.egalWennDa ? ' ON CONFLICT (user_id, set_number) DO NOTHING' : ''),
    [userId, setNumber]);
  if (menge > 0) await erfasse(db, userId, setNumber, menge, opt);
}

/**
 * Eine weitere Erfassung zu einem bestehenden Bestand.
 *
 * COALESCE auf dem Datum und nicht zwei Abfragen: NOW() als Standardwert geht
 * nicht als Parameter, und zwei Textfassungen derselben Anweisung sind genau
 * die Doppelung, die diese Datei vermeidet.
 */
async function erfasse(db, userId, setNumber, menge, opt = {}) {
  await db.run(
    `INSERT INTO set_acquisitions (user_id, set_number, quantity, purchase_price, condition, created_at)
     VALUES ($1,$2,$3,$4,$5, COALESCE($6::timestamptz, NOW()))`,
    [userId, setNumber, menge, opt.preis ?? null, opt.zustand ?? 'N', opt.am ?? null]);
}

/**
 * Die Stückzahl eines Sets, wie der Server sie seit Migration 0036 sieht.
 *
 * Ersetzt das `SELECT quantity FROM sets` der Zusicherungen. Der JOIN auf
 * `sets` ist dieselbe Einschränkung wie in utils/bestandsmenge.ts: Eine
 * Erfassung ohne Bestandszeile zählt nicht mit.
 *
 * @param konten eine Konto-ID oder eine Liste (dann über alle summiert)
 */
async function mengeVon(db, konten, setNumber) {
  const ids = Array.isArray(konten) ? konten : [konten];
  const z = await db.get(
    `SELECT COALESCE(SUM(a.quantity), 0)::int AS q
       FROM set_acquisitions a
       JOIN sets s ON s.user_id = a.user_id AND s.set_number = a.set_number
      WHERE a.user_id = ANY($1) AND a.set_number = $2`,
    [ids, setNumber]);
  return z ? Number(z.q) : 0;
}

/** Gibt es die Bestandszeile überhaupt? Getrennt von der Menge, weil „kein
 *  Bestand" und „Bestand mit 0 Exemplaren" zwei verschiedene Aussagen sind. */
async function haltZeile(db, userId, setNumber) {
  return await db.get('SELECT id FROM sets WHERE user_id=$1 AND set_number=$2',
    [userId, setNumber]);
}

// ═══════════════════════════════════════════════════════════════════════════
// Teile und Minifiguren
// ═══════════════════════════════════════════════════════════════════════════
//
// Dieselbe Geschichte wie bei den Sets, eine Migration spaeter: Bis 0038 stand
// die Stückzahl in `parts.quantity` bzw. `minifigs.quantity`, und 79
// Testaufbauten schrieben sie dorthin (gemessen). Die Spalte trug ZWEI
// Bedeutungen, und beide waren Abschriften:
//
//   source='manual'  Summe der Erfassungen       → part_acquisitions
//   source='set'     Stückzahl im Set            → set_parts_catalog.quantity
//
// Ein Bestand ist seitdem ZWEI Zeilen, und welche zweite es ist, haengt an der
// Herkunft. Genau das nehmen die beiden Funktionen hier auseinander — damit
// ein Testaufbau sagt, WAS er herstellt, und nicht, in welche Spalten er
// schreibt.

/**
 * „Dieses Konto hält dieses Teil."
 *
 * @param opt.setNumber  Aus welchem Set. Fehlt sie, ist es ein MANUELL
 *                       erfasstes Teil (source='manual'), und die Menge geht
 *                       in eine Erfassung. Steht sie da, ist es ein Set-Teil
 *                       (source='set'), und die Menge ist die KATALOGZAHL.
 * @param opt.menge      Stückzahl (Standard 1)
 * @param opt.colorId    Farbe (Standard 0)
 * @param opt.preis      Kaufpreis der Erfassung — nur fuer manuelle Teile
 * @param opt.zustand    'N' oder 'U' (Standard 'N'), nur fuer manuelle Teile
 * @param opt.am         Aufnahmedatum der Erfassung. idx_part_acq_tag
 *                       (Migration 0008) erlaubt je Konto, Teil, Farbe und
 *                       TAG nur eine Erfassung — genau wie bei den Sets.
 *                       Hier stand das Gegenteil, und es war falsch:
 *                       GEMESSEN brachen fuenf Testdateien mit „duplicate
 *                       key value violates unique constraint
 *                       idx_part_acq_tag" ab.
 * @param opt.storageId  Lagerort
 */
async function haeltTeil(db, userId, partNumber, opt = {}) {
  const { setNumber = null, menge = 1, colorId = 0 } = opt;
  const quelle = setNumber ? 'set' : 'manual';
  await db.run(
    `INSERT INTO parts (user_id, set_number, part_number, color_id, source, storage_id)
     VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING`,
    [userId, setNumber, partNumber, colorId, quelle, opt.storageId ?? null]);
  if (setNumber) {
    // Die Katalogzahl — ohne sie faellt teilmengeAus() auf den Rueckfall 1
    // zurueck, und ein Set mit vier gleichen Steinen zaehlte als einer.
    await db.run(
      `INSERT INTO set_parts_catalog (set_number, part_number, color_id, quantity)
       VALUES ($1,$2,$3,$4)
       ON CONFLICT (set_number, part_number, color_id) DO UPDATE SET quantity = $4`,
      [setNumber, partNumber, colorId, menge]);
  } else if (menge > 0) {
    // ON CONFLICT auf die Tagesregel: Ein zweiter Aufruf fuer dieselbe
    // Position SETZT die Menge, statt abzubrechen oder sie zu addieren.
    // Das ist die Zusage dieser Funktion — „dieses Konto haelt N davon",
    // nicht „kauf N dazu". Wer zwei Kaeufe braucht, gibt zwei Daten mit
    // (opt.am) oder ruft erfasseTeil() zweimal.
    await db.run(
      `INSERT INTO part_acquisitions (user_id, part_number, color_id, quantity, unit_price, condition, created_at)
       VALUES ($1,$2,$3,$4,$5,$6, COALESCE($7::timestamptz, NOW()))
       ON CONFLICT (user_id, part_number, color_id, ((created_at AT TIME ZONE 'UTC')::date))
       DO UPDATE SET quantity = EXCLUDED.quantity,
                     unit_price = COALESCE(EXCLUDED.unit_price, part_acquisitions.unit_price),
                     condition = EXCLUDED.condition`,
      [userId, partNumber, colorId, menge,
       opt.preis ?? null, opt.zustand ?? 'N', opt.am ?? null]);
  }
}

/**
 * „Dieses Konto hält diese Minifigur." Wortgleich zu [haeltTeil], ohne Farbe.
 */
async function haeltFigur(db, userId, figNumber, opt = {}) {
  const { setNumber = null, menge = 1 } = opt;
  const quelle = setNumber ? 'set' : 'manual';
  await db.run(
    `INSERT INTO minifigs (user_id, set_number, fig_number, source, storage_id)
     VALUES ($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING`,
    [userId, setNumber, figNumber, quelle, opt.storageId ?? null]);
  if (setNumber) {
    await db.run(
      `INSERT INTO set_minifigs_catalog (set_number, fig_number, quantity)
       VALUES ($1,$2,$3)
       ON CONFLICT (set_number, fig_number) DO UPDATE SET quantity = $3`,
      [setNumber, figNumber, menge]);
  } else if (menge > 0) {
    // ON CONFLICT auf die Tagesregel — siehe haeltTeil().
    await db.run(
      `INSERT INTO minifig_acquisitions (user_id, fig_number, quantity, unit_price, condition, created_at)
       VALUES ($1,$2,$3,$4,$5, COALESCE($6::timestamptz, NOW()))
       ON CONFLICT (user_id, fig_number, ((created_at AT TIME ZONE 'UTC')::date))
       DO UPDATE SET quantity = EXCLUDED.quantity,
                     unit_price = COALESCE(EXCLUDED.unit_price, minifig_acquisitions.unit_price),
                     condition = EXCLUDED.condition`,
      [userId, figNumber, menge, opt.preis ?? null, opt.zustand ?? 'N', opt.am ?? null]);
  }
}

/**
 * Die Stückzahl einer Bestandszeile, wie der Server sie seit Migration 0038
 * sieht — die Fallunterscheidung, in JavaScript nachgefragt.
 *
 * Ersetzt das `SELECT quantity FROM parts` der Zusicherungen.
 */
async function teilmengeVon(db, userId, partNumber, colorId = 0) {
  const z = await db.get(
    `SELECT CASE WHEN COALESCE(p.source,'set') = 'manual'
                 THEN COALESCE((SELECT SUM(a.quantity) FROM part_acquisitions a
                                 WHERE a.user_id = p.user_id
                                   AND a.part_number = p.part_number
                                   AND COALESCE(a.color_id,0) = COALESCE(p.color_id,0)), 0)
                 ELSE COALESCE(c.quantity, 1) END::int AS menge
       FROM parts p
       LEFT JOIN set_parts_catalog c ON c.set_number = p.set_number
                                    AND c.part_number = p.part_number
                                    AND c.color_id = COALESCE(p.color_id,0)
      WHERE p.user_id=$1 AND p.part_number=$2 AND COALESCE(p.color_id,0)=$3`,
    [userId, partNumber, colorId]);
  return z ? Number(z.menge) : null;
}

/** Dasselbe fuer eine Minifigur. */
async function figurmengeVon(db, userId, figNumber) {
  const z = await db.get(
    `SELECT CASE WHEN COALESCE(m.source,'set') = 'manual'
                 THEN COALESCE((SELECT SUM(a.quantity) FROM minifig_acquisitions a
                                 WHERE a.user_id = m.user_id
                                   AND a.fig_number = m.fig_number), 0)
                 ELSE COALESCE(c.quantity, 1) END::int AS menge
       FROM minifigs m
       LEFT JOIN set_minifigs_catalog c ON c.set_number = m.set_number
                                      AND c.fig_number = m.fig_number
      WHERE m.user_id=$1 AND m.fig_number=$2`,
    [userId, figNumber]);
  return z ? Number(z.menge) : null;
}

module.exports = { haeltSet, erfasse, mengeVon, haltZeile,
                   haeltTeil, haeltFigur, teilmengeVon, figurmengeVon };
