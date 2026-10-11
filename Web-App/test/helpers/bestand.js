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

module.exports = { haeltSet, erfasse, mengeVon, haltZeile };
