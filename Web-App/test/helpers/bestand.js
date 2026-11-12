/**
 * Bestand anlegen und lesen — für Testaufbauten.
 */
const path = require('node:path');

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
 * @param {object} [opt] Optionen:
 * @param [opt.preis]    Kaufpreis der Erfassung (Standard: keiner)
 * @param [opt.zustand]  'N' oder 'U' (Standard 'N')
 * @param [opt.am]       Aufnahmedatum der Erfassung (Standard: jetzt).
 *                     idx_set_acq_tag_zustand erlaubt je Konto, Set, TAG und
 *                     ZUSTAND nur eine Erfassung — mehrere Käufe desselben
 *                     Sets im selben Zustand brauchen also verschiedene Tage.
 *                     (Der Zustand steht seit Migration 0040 im Schlüssel;
 *                     davor galt die Regel ohne ihn, und zwei Käufe eines
 *                     Tages wurden zu einer Zeile mit Mischpreis.)
 * @param [opt.egalWennDa]  true: eine schon vorhandene sets-Zeile ist in Ordnung
 */
async function haeltSet(db, userId, setNumber, menge = 1, opt = {}) {
  await db.run(
    `INSERT INTO sets (user_id, set_number) VALUES ($1,$2)` +
      (opt.egalWennDa ? ' ON CONFLICT (user_id, set_number) DO NOTHING' : ''),
    [userId, setNumber],
  );
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
    [userId, setNumber, menge, opt.preis ?? null, opt.zustand ?? 'N', opt.am ?? null],
  );
}

/**
 * Die Stückzahl eines Sets, wie der Server sie seit Migration 0036 sieht.
 *
 * Ersetzt das `SELECT quantity FROM sets` der Zusicherungen. Der JOIN auf
 * `sets` ist dieselbe Einschränkung wie in db/bestandsmenge.ts: Eine
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
    [ids, setNumber],
  );
  return z ? Number(z.q) : 0;
}

/** Gibt es die Bestandszeile überhaupt? Getrennt von der Menge, weil „kein
 *  Bestand" und „Bestand mit 0 Exemplaren" zwei verschiedene Aussagen sind. */
async function haltZeile(db, userId, setNumber) {
  return await db.get('SELECT id FROM sets WHERE user_id=$1 AND set_number=$2', [userId, setNumber]);
}

// ═══════════════════════════════════════════════════════════════════════════
// Teile und Minifiguren
// ═══════════════════════════════════════════════════════════════════════════

/**
 * „Dieses Konto hält dieses Teil."
 *
 * @param {object} [opt] Optionen:
 * @param [opt.setNumber]  Aus welchem Set. Fehlt sie, ist es ein MANUELL
 *                       erfasstes Teil (source='manual'), und die Menge geht
 *                       in eine Erfassung. Steht sie da, ist es ein Set-Teil
 *                       (source='set'), und die Menge ist die KATALOGZAHL.
 * @param [opt.menge]      Stückzahl (Standard 1)
 * @param [opt.colorId]    Farbe (Standard 0)
 * @param [opt.preis]      Kaufpreis der Erfassung — nur fuer manuelle Teile
 * @param [opt.zustand]    'N' oder 'U' (Standard 'N'), nur fuer manuelle Teile
 * @param [opt.am]         Aufnahmedatum der Erfassung. idx_part_acq_tag_zustand
 *                       (Migration 0008, erweitert in 0040) erlaubt je Konto,
 *                       Teil, Farbe, TAG und ZUSTAND nur eine Erfassung —
 *                       genau wie bei den Sets.
 *                       Hier stand das Gegenteil, und es war falsch:
 *                       GEMESSEN brachen fuenf Testdateien mit „duplicate
 *                       key value violates unique constraint
 *                       idx_part_acq_tag_zustand" ab.
 * @param [opt.storageId]  Lagerort
 */
async function haeltTeil(db, userId, partNumber, opt = {}) {
  const { setNumber = null, menge = 1, colorId = 0 } = opt;
  const quelle = setNumber ? 'set' : 'manual';
  // Ein Set-Teil gehört zu einem Set des Kontos (Fremdschlüssel, Migration 0058).
  if (setNumber)
    await db.run('INSERT INTO sets (user_id, set_number) VALUES ($1,$2) ON CONFLICT DO NOTHING', [userId, setNumber]);
  await db.run(
    `INSERT INTO parts (user_id, set_number, part_number, color_id, source, storage_id)
     VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING`,
    [userId, setNumber, partNumber, colorId, quelle, opt.storageId ?? null],
  );
  if (setNumber) {
    // Die Katalogzahl — ohne sie faellt teilmengeAus() auf den Rueckfall 1
    // zurueck, und ein Set mit vier gleichen Steinen zaehlte als einer.
    await db.run(
      `INSERT INTO set_teile (set_number, part_number, color_id, quantity)
       VALUES ($1,$2,$3,$4)
       ON CONFLICT (set_number, part_number, color_id) DO UPDATE SET quantity = $4`,
      [setNumber, partNumber, colorId, menge],
    );
  } else if (menge > 0) {
    // ON CONFLICT auf die Tagesregel: Ein zweiter Aufruf fuer dieselbe
    // Position SETZT die Menge, statt abzubrechen oder sie zu addieren.
    // Das ist die Zusage dieser Funktion — „dieses Konto haelt N davon",
    // nicht „kauf N dazu". Wer zwei Kaeufe braucht, gibt zwei Daten mit …
    await db.run(
      `DELETE FROM part_acquisitions
        WHERE user_id = $1 AND part_number = $2 AND color_id = $3 AND condition = $4
          AND (created_at AT TIME ZONE 'UTC')::date = (COALESCE($5::timestamptz, NOW()) AT TIME ZONE 'UTC')::date`,
      [userId, partNumber, colorId, opt.zustand ?? 'N', opt.am ?? null],
    );
    await db.run(
      `INSERT INTO part_acquisitions (user_id, part_number, color_id, quantity, unit_price, condition, created_at)
       VALUES ($1,$2,$3,$4,$5,$6, COALESCE($7::timestamptz, NOW()))`,
      [userId, partNumber, colorId, menge, opt.preis ?? null, opt.zustand ?? 'N', opt.am ?? null],
    );
  }
}

/**
 * „Dieses Konto hält diese Minifigur." Wortgleich zu [haeltTeil], ohne Farbe.
 */
async function haeltFigur(db, userId, figNumber, opt = {}) {
  const { setNumber = null, menge = 1 } = opt;
  const quelle = setNumber ? 'set' : 'manual';
  if (setNumber)
    await db.run('INSERT INTO sets (user_id, set_number) VALUES ($1,$2) ON CONFLICT DO NOTHING', [userId, setNumber]);
  await db.run(
    `INSERT INTO minifigs (user_id, set_number, fig_number, source, storage_id)
     VALUES ($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING`,
    [userId, setNumber, figNumber, quelle, opt.storageId ?? null],
  );
  if (setNumber) {
    await db.run(
      `INSERT INTO set_figuren (set_number, fig_number, quantity)
       VALUES ($1,$2,$3)
       ON CONFLICT (set_number, fig_number) DO UPDATE SET quantity = $3`,
      [setNumber, figNumber, menge],
    );
  } else if (menge > 0) {
    // ON CONFLICT auf die Tagesregel — siehe haeltTeil().
    await db.run(
      `DELETE FROM minifig_acquisitions
        WHERE user_id = $1 AND fig_number = $2 AND condition = $3
          AND (created_at AT TIME ZONE 'UTC')::date = (COALESCE($4::timestamptz, NOW()) AT TIME ZONE 'UTC')::date`,
      [userId, figNumber, opt.zustand ?? 'N', opt.am ?? null],
    );
    await db.run(
      `INSERT INTO minifig_acquisitions (user_id, fig_number, quantity, unit_price, condition, created_at)
       VALUES ($1,$2,$3,$4,$5, COALESCE($6::timestamptz, NOW()))`,
      [userId, figNumber, menge, opt.preis ?? null, opt.zustand ?? 'N', opt.am ?? null],
    );
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
    [userId, partNumber, colorId],
  );
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
    [userId, figNumber],
  );
  return z ? Number(z.menge) : null;
}

/**
 * Ein Set im Katalog (Migration 0105): Name, Jahr, Thema und Teile in rb_sets
 * (das Thema über seinen Namen in rb_themes), Figuren und Bild in set_catalog.
 * Fehlende Felder lassen vorhandene Werte stehen. `herkunft` wie in rb_sets
 * ('api' als Vorgabe: so legt die Erfassung an).
 */
async function katalogSet(db, setNumber, f = {}) {
  let themeId = null;
  if (f.theme) {
    let h = 0;
    for (const z of f.theme) h = (h * 31 + z.charCodeAt(0)) % 90000;
    themeId = 900000 + h;
    await db.run('INSERT INTO rb_themes (id, name) VALUES ($1, $2) ON CONFLICT (id) DO NOTHING', [themeId, f.theme]);
  }
  await db.run(
    `INSERT INTO rb_sets (set_num, name, year, theme_id, num_parts, herkunft)
                VALUES (set_nummer_mit_version($1), COALESCE($2, 'Set ' || set_nummer_mit_version($1)), $3, $4, $5, $6)
                ON CONFLICT (set_num) DO UPDATE SET name = COALESCE($2, rb_sets.name),
                  year = COALESCE($3, rb_sets.year), theme_id = COALESCE($4, rb_sets.theme_id),
                  num_parts = COALESCE($5, rb_sets.num_parts), herkunft = $6`,
    [setNumber, f.name ?? null, f.year ?? null, themeId, f.pieces ?? null, f.herkunft ?? 'api'],
  );
  await db.run(
    `INSERT INTO set_catalog (set_number, minifigs, image_url, image_local, brickset_id)
                VALUES (set_nummer_mit_version($1), $2, $3, $4, $5)
                ON CONFLICT (set_number) DO UPDATE SET minifigs = COALESCE($2, set_catalog.minifigs),
                  image_url = COALESCE($3, set_catalog.image_url), image_local = COALESCE($4, set_catalog.image_local),
                  brickset_id = COALESCE($5, set_catalog.brickset_id)`,
    [setNumber, f.minifigs ?? null, f.image_url ?? null, f.image_local ?? null, f.brickset_id ?? null],
  );
}

/**
 * Eine Sammlung, in der jede Ansicht etwas zeigt: Sets mit Thema, Kaufpreis
 * (auch 0 = Geschenk), Marktpreis und Verlauf, Teile in mehreren Farben
 * (Schwarz für den Farbpunkt im Dunkelmodus), Figuren und Merkliste. Für
 * Layout-, Kontrast- und axe-Prüfungen, die sonst leere Listen prüften.
 */
async function musterSammlung(db, uid) {
  const sets = [
    ['10294-1', 'Titanic', 'Icons / Modular Buildings Collection', 2021, 9090, 679.99, 'N', 712.4],
    ['75192-1', 'Millennium Falcon Ultimate Collector Series', 'Star Wars', 2017, 7541, 650, 'U', 801.5],
    ['10300-1', 'Back to the Future Time Machine', 'Icons', 2022, 1872, 0, 'N', 163.8],
    ['21318-1', 'Tree House', 'Ideas', 2019, 3036, 199.99, 'N', 186.2],
  ];
  for (const [nr, name, thema, jahr, teile, preis, zustand, markt] of sets) {
    await katalogSet(db, nr, { name, year: jahr, theme: thema, pieces: teile, minifigs: 4 });
    await haeltSet(db, uid, nr, 1, { preis, zustand, am: '2026-06-01T10:00:00Z' });
    await db.run(
      `INSERT INTO price_cache (set_number, condition, currency_code, min_price, avg_price, max_price, qty_avg_price, total_quantity, fetched_at)
                  VALUES ($1,$2,'EUR',$3,$4,$5,$4,12,NOW()) ON CONFLICT (set_number, condition, currency_code) DO UPDATE SET avg_price = $4, qty_avg_price = $4`,
      [nr, zustand, markt * 0.85, markt, markt * 1.2],
    );
    for (let tag = 60; tag >= 0; tag -= 3)
      await db.run(
        `INSERT INTO price_history (set_number, condition, currency_code, avg_price, qty_avg_price, recorded_at)
                    VALUES ($1,$2,'EUR',$3,$3, NOW() - ($4 || ' days')::interval) ON CONFLICT DO NOTHING`,
        [nr, zustand, Math.round(markt * (0.9 + 0.1 * Math.sin(tag / 9) + (60 - tag) / 600) * 100) / 100, String(tag)],
      );
  }
  await db.run(
    `INSERT INTO wanted (user_id, set_number, condition) VALUES ($1, '10276-1', 'N') ON CONFLICT DO NOTHING`,
    [uid],
  );
  const farben = [
    [0, 'Black', '05131D'],
    [4, 'Red', 'C91A09'],
    [1, 'Blue', '0055BF'],
    [15, 'White', 'FFFFFF'],
  ];
  for (const [id, name, rgb] of farben)
    await db.run(`INSERT INTO rb_colors (id, name, rgb, is_trans) VALUES ($1,$2,$3,'f') ON CONFLICT (id) DO NOTHING`, [
      id,
      name,
      rgb,
    ]);
  for (const [teil, name] of [
    ['3001', 'Brick 2 x 4'],
    ['3020', 'Plate 2 x 4'],
    ['3023', 'Plate 1 x 2'],
  ]) {
    await db.run(
      `INSERT INTO part_catalog (part_number, part_name, category_name) VALUES ($1,$2,'Bricks') ON CONFLICT DO NOTHING`,
      [teil, name],
    );
    for (const [id, fname, rgb] of farben) {
      await db.run(
        `INSERT INTO part_color_catalog (part_number, color_id, color_name, color_hex) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING`,
        [teil, id, fname, rgb],
      );
      await haeltTeil(db, uid, teil, { setNumber: '10294-1', colorId: id, menge: 12 });
    }
  }
  await haeltTeil(db, uid, '3001', { colorId: 0, menge: 250, preis: 0.12 });
  await db.run(
    `INSERT INTO minifigs_catalog (fig_number, fig_name) VALUES ('fig-000001', 'Marty McFly') ON CONFLICT DO NOTHING`,
  );
  await haeltFigur(db, uid, 'fig-000001', { setNumber: '10300-1', menge: 1 });
  await db.run(
    `INSERT INTO minifigs_catalog (fig_number, fig_name) VALUES ('fig-000002', 'Doc Brown') ON CONFLICT DO NOTHING`,
  );
  await haeltFigur(db, uid, 'fig-000002', { menge: 2, preis: 4.5 });
  // Über den Dienst: Nur er verschlüsselt die Nummer, wie es die Datenbank verlangt.
  await require(
    path.join(__dirname, '..', '..', 'dist', 'src', 'gutscheine', 'repository', 'gutscheine.js'),
  ).gutscheinAnlegen(db, uid, { number: '6123-4567-8901', pin: '4711', amount: 50, currency: 'EUR' });
  await db.run(
    `INSERT INTO price_alerts (user_id, set_number, condition, richtung, schwelle, currency_code)
                VALUES ($1, '10276-1', 'N', 'unter', 299, 'EUR') ON CONFLICT DO NOTHING`,
    [uid],
  );
  await db.run(`INSERT INTO storage_locations (user_id, name) VALUES ($1, 'Regal Keller')`, [uid]);
}

/**
 * musterSammlung plus ein verknüpftes Unterkonto „<Konto>_kind“, das ein Set
 * der Sammlung zu einem anderen Preis hält: Haushaltszeilen, Besitzer und
 * „Verknüpfung lösen“ kommen so in die gemessenen Ansichten. starteApp löscht
 * Konten mit dem Präfix „<Konto>_“ mit.
 */
async function musterHaushalt(db, uid) {
  await musterSammlung(db, uid);
  const { username } = await db.get('SELECT username FROM users WHERE id = $1', [uid]);
  const kind = `${username}_kind`;
  await db.run('DELETE FROM users WHERE username = $1', [kind]);
  const kid = (
    await db.get(
      `INSERT INTO users (username, email, password_hash, is_active, email_verified)
    VALUES ($1, $2, 'x', true, true) RETURNING id`,
      [kind, `${kind}@example.org`],
    )
  ).id;
  await db.run('INSERT INTO account_links (main_user_id, sub_user_id) VALUES ($1, $2)', [uid, kid]);
  await haeltSet(db, kid, '21318-1', 1, { preis: 210, am: '2026-06-02T10:00:00Z' });
  return kid;
}

module.exports = {
  katalogSet,
  musterSammlung,
  musterHaushalt,
  haeltSet,
  erfasse,
  mengeVon,
  haltZeile,
  haeltTeil,
  haeltFigur,
  teilmengeVon,
  figurmengeVon,
};
