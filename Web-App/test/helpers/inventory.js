/**
 * Create and read stock — for test setups.
 */
const path = require('node:path');

/**
 * “This account holds this set, this many copies."
 *
 * @param db   the access for test data (sources testData())
 * @param userId  account
 * @param setNumber  set number
 * @param quantity  copies. 0 is allowed and means “stock row without
 *               entry" — a valid state (say after deleting the
 *               last entry via the quantity control), and exactly the case
 *               to which the lists must answer with 0.
 * @param {object} [opt] options:
 * @param [opt.preis]    purchase price of the entry (default: none)
 * @param [opt.condition]  'N' or 'U' (default 'N')
 * @param [opt.am]       date the entry was added (default: now).
 *                     idx_set_acq_tag_zustand allows only one entry per account, set, DAY and
 *                     CONDITION — several purchases of the same
 *                     set in the same condition therefore need different days.
 *                     (The condition has been in the key since migration 0040;
 *                     before that the rule applied without it, and two purchases of one
 *                     day became one row with a mixed price.)
 * @param [opt.anywayIfDa]  true: an already existing sets row is fine
 */
async function holdsSet(db, userId, setNumber, quantity = 1, opt = {}) {
  await db.run(
    `INSERT INTO sets (user_id, set_number) VALUES ($1,$2)` +
      (opt.anywayIfDa ? ' ON CONFLICT (user_id, set_number) DO NOTHING' : ''),
    [userId, setNumber],
  );
  if (quantity > 0) await record(db, userId, setNumber, quantity, opt);
}

/**
 * Another entry for an existing stock.
 *
 * COALESCE on the date and not two queries: NOW() as a default value cannot
 * go as a parameter, and two text versions of the same statement are exactly
 * the duplication this file avoids.
 */
async function record(db, userId, setNumber, quantity, opt = {}) {
  await db.run(
    `INSERT INTO set_acquisitions (user_id, set_number, quantity, purchase_price, condition, created_at)
     VALUES ($1,$2,$3,$4,$5, COALESCE($6::timestamptz, NOW()))`,
    [userId, setNumber, quantity, opt.preis ?? null, opt.condition ?? 'N', opt.am ?? null],
  );
}

/**
 * The item count of a set as the server sees it since migration 0036.
 *
 * Replaces the `SELECT quantity FROM sets` of the assertions. The JOIN on
 * `sets` is the same restriction as in db/stockQuantity.ts: an
 * entry without a stock row does not count.
 *
 * @param konten an account ID or a list (then summed over all)
 */
async function quantityOf(db, konten, setNumber) {
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

/** Does the stock row exist at all? Separate from the quantity because “no
 *  stock" and “stock with 0 copies" are two different statements. */
async function haltRow(db, userId, setNumber) {
  return await db.get('SELECT id FROM sets WHERE user_id=$1 AND set_number=$2', [userId, setNumber]);
}

// ═══════════════════════════════════════════════════════════════════════════
// Parts and minifigures
// ═══════════════════════════════════════════════════════════════════════════

/**
 * “This account holds this part."
 *
 * @param {object} [opt] options:
 * @param [opt.setNumber]  From which set. If missing, it is a MANUALLY
 *                       entered part (source='manual'), and the quantity goes
 *                       into an entry. If given, it is a set part
 *                       (source='set'), and the quantity is the CATALOG COUNT.
 * @param [opt.quantity]      item count (default 1)
 * @param [opt.colorId]    color (default 0)
 * @param [opt.preis]      purchase price of the entry — only for manual parts
 * @param [opt.condition]    'N' or 'U' (default 'N'), only for manual parts
 * @param [opt.am]         date the entry was added; idx_part_acq_tag_zustand allows only one entry per
 *                       account, part, color, day and condition.
 * @param [opt.storageId]  storage location
 * @param [opt.anywayIfDa]  without effect for parts; only for parity with holdsSet
 */
async function holdsPart(db, userId, partNumber, opt = {}) {
  const { setNumber = null, quantity = 1, colorId = 0 } = opt;
  const source = setNumber ? 'set' : 'manual';
  // A set part belongs to a set of the account (foreign key, migration 0058).
  if (setNumber)
    await db.run('INSERT INTO sets (user_id, set_number) VALUES ($1,$2) ON CONFLICT DO NOTHING', [userId, setNumber]);
  await db.run(
    `INSERT INTO parts (user_id, set_number, part_number, color_id, source, storage_id)
     VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING`,
    [userId, setNumber, partNumber, colorId, source, opt.storageId ?? null],
  );
  if (setNumber) {
    // The catalog count — without it subsetFrom() falls back to the fallback 1,
    // and a set with four equal bricks would count as one.
    await db.run(
      `INSERT INTO set_parts (set_number, part_number, color_id, quantity)
       VALUES ($1,$2,$3,$4)
       ON CONFLICT (set_number, part_number, color_id) DO UPDATE SET quantity = $4`,
      [setNumber, partNumber, colorId, quantity],
    );
  } else if (quantity > 0) {
    // ON CONFLICT on the daily rule: a second call for the same
    // item SETS the quantity instead of aborting or adding it.
    // That is the promise of this function — “this account holds N of them",
    // not “buy N more". Whoever needs two purchases passes two dates …
    await db.run(
      `DELETE FROM part_acquisitions
        WHERE user_id = $1 AND part_number = $2 AND color_id = $3 AND condition = $4
          AND (created_at AT TIME ZONE 'UTC')::date = (COALESCE($5::timestamptz, NOW()) AT TIME ZONE 'UTC')::date`,
      [userId, partNumber, colorId, opt.condition ?? 'N', opt.am ?? null],
    );
    await db.run(
      `INSERT INTO part_acquisitions (user_id, part_number, color_id, quantity, unit_price, condition, created_at)
       VALUES ($1,$2,$3,$4,$5,$6, COALESCE($7::timestamptz, NOW()))`,
      [userId, partNumber, colorId, quantity, opt.preis ?? null, opt.condition ?? 'N', opt.am ?? null],
    );
  }
}

/**
 * “This account holds this minifigure." Word for word like [holdsPart], without color.
 */
async function holdsMinifig(db, userId, figNumber, opt = {}) {
  const { setNumber = null, quantity = 1 } = opt;
  const source = setNumber ? 'set' : 'manual';
  if (setNumber)
    await db.run('INSERT INTO sets (user_id, set_number) VALUES ($1,$2) ON CONFLICT DO NOTHING', [userId, setNumber]);
  await db.run(
    `INSERT INTO minifigs (user_id, set_number, fig_number, source, storage_id)
     VALUES ($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING`,
    [userId, setNumber, figNumber, source, opt.storageId ?? null],
  );
  if (setNumber) {
    await db.run(
      `INSERT INTO set_minifigs (set_number, fig_number, quantity)
       VALUES ($1,$2,$3)
       ON CONFLICT (set_number, fig_number) DO UPDATE SET quantity = $3`,
      [setNumber, figNumber, quantity],
    );
  } else if (quantity > 0) {
    // ON CONFLICT on the daily rule — see holdsPart().
    await db.run(
      `DELETE FROM minifig_acquisitions
        WHERE user_id = $1 AND fig_number = $2 AND condition = $3
          AND (created_at AT TIME ZONE 'UTC')::date = (COALESCE($4::timestamptz, NOW()) AT TIME ZONE 'UTC')::date`,
      [userId, figNumber, opt.condition ?? 'N', opt.am ?? null],
    );
    await db.run(
      `INSERT INTO minifig_acquisitions (user_id, fig_number, quantity, unit_price, condition, created_at)
       VALUES ($1,$2,$3,$4,$5, COALESCE($6::timestamptz, NOW()))`,
      [userId, figNumber, quantity, opt.preis ?? null, opt.condition ?? 'N', opt.am ?? null],
    );
  }
}

/**
 * The item count of a stock row as the server sees it since migration 0038
 * — the case distinction, asked in JavaScript.
 *
 * Replaces the `SELECT quantity FROM parts` of the assertions.
 */
async function subsetOf(db, userId, partNumber, colorId = 0) {
  const z = await db.get(
    `SELECT CASE WHEN COALESCE(p.source,'set') = 'manual'
                 THEN COALESCE((SELECT SUM(a.quantity) FROM part_acquisitions a
                                 WHERE a.user_id = p.user_id
                                   AND a.part_number = p.part_number
                                   AND COALESCE(a.color_id,0) = COALESCE(p.color_id,0)), 0)
                 ELSE COALESCE(c.quantity, 1) END::int AS quantity
       FROM parts p
       LEFT JOIN set_parts_catalog c ON c.set_number = p.set_number
                                    AND c.part_number = p.part_number
                                    AND c.color_id = COALESCE(p.color_id,0)
      WHERE p.user_id=$1 AND p.part_number=$2 AND COALESCE(p.color_id,0)=$3`,
    [userId, partNumber, colorId],
  );
  return z ? Number(z.quantity) : null;
}

/** The same for a minifigure. */
async function minifigQuantityOf(db, userId, figNumber) {
  const z = await db.get(
    `SELECT CASE WHEN COALESCE(m.source,'set') = 'manual'
                 THEN COALESCE((SELECT SUM(a.quantity) FROM minifig_acquisitions a
                                 WHERE a.user_id = m.user_id
                                   AND a.fig_number = m.fig_number), 0)
                 ELSE COALESCE(c.quantity, 1) END::int AS quantity
       FROM minifigs m
       LEFT JOIN set_minifigs_catalog c ON c.set_number = m.set_number
                                      AND c.fig_number = m.fig_number
      WHERE m.user_id=$1 AND m.fig_number=$2`,
    [userId, figNumber],
  );
  return z ? Number(z.quantity) : null;
}

/**
 * A set in the catalog (migration 0105): name, year, theme and parts in rb_sets
 * (the theme via its name in rb_themes), minifigures and image in set_catalog.
 * Missing fields leave existing values alone. `herkunft` as in rb_sets
 * ('api' as default: that is how adding creates it).
 */
async function catalogSet(db, setNumber, f = {}) {
  let themeId = null;
  if (f.theme) {
    let h = 0;
    for (const z of f.theme) h = (h * 31 + z.charCodeAt(0)) % 90000;
    themeId = 900000 + h;
    await db.run('INSERT INTO rb_themes (id, name) VALUES ($1, $2) ON CONFLICT (id) DO NOTHING', [themeId, f.theme]);
  }
  await db.run(
    `INSERT INTO rb_sets (set_num, name, year, theme_id, num_parts, source)
                VALUES (set_number_with_version($1), COALESCE($2, 'Set ' || set_number_with_version($1)), $3, $4, $5, $6)
                ON CONFLICT (set_num) DO UPDATE SET name = COALESCE($2, rb_sets.name),
                  year = COALESCE($3, rb_sets.year), theme_id = COALESCE($4, rb_sets.theme_id),
                  num_parts = COALESCE($5, rb_sets.num_parts), source = $6`,
    [setNumber, f.name ?? null, f.year ?? null, themeId, f.pieces ?? null, f.herkunft ?? 'api'],
  );
  await db.run(
    `INSERT INTO set_catalog (set_number, minifigs, image_url, image_local, brickset_id)
                VALUES (set_number_with_version($1), $2, $3, $4, $5)
                ON CONFLICT (set_number) DO UPDATE SET minifigs = COALESCE($2, set_catalog.minifigs),
                  image_url = COALESCE($3, set_catalog.image_url), image_local = COALESCE($4, set_catalog.image_local),
                  brickset_id = COALESCE($5, set_catalog.brickset_id)`,
    [setNumber, f.minifigs ?? null, f.image_url ?? null, f.image_local ?? null, f.brickset_id ?? null],
  );
}

/**
 * A collection in which every view shows something: sets with theme, purchase price
 * (also 0 = gift), market price and history, parts in several colors
 * (black for the color dot in dark mode), minifigures and wishlist. For
 * layout, contrast and axe checks that would otherwise check empty lists.
 */
async function patternCollection(db, uid) {
  const sets = [
    ['10294-1', 'Titanic', 'Icons / Modular Buildings Collection', 2021, 9090, 679.99, 'N', 712.4],
    ['75192-1', 'Millennium Falcon Ultimate Collector Series', 'Star Wars', 2017, 7541, 650, 'U', 801.5],
    ['10300-1', 'Back to the Future Time Machine', 'Icons', 2022, 1872, 0, 'N', 163.8],
    ['21318-1', 'Tree House', 'Ideas', 2019, 3036, 199.99, 'N', 186.2],
  ];
  for (const [
    nr,
    name,
    thema,
    jahr,
    parts,
    preis,
    condition,
    markt,
  ] of /** @type {[string, string, string, number, number, number, string, number][]} */ (sets)) {
    await catalogSet(db, nr, { name, year: jahr, theme: thema, pieces: parts, minifigs: 4 });
    await holdsSet(db, uid, nr, 1, { preis, condition, am: '2026-06-01T10:00:00Z' });
    await db.run(
      `INSERT INTO price_cache (set_number, condition, currency_code, min_price, avg_price, max_price, qty_avg_price, total_quantity, fetched_at)
                  VALUES ($1,$2,'EUR',$3,$4,$5,$4,12,NOW()) ON CONFLICT (set_number, condition, currency_code) DO UPDATE SET avg_price = $4, qty_avg_price = $4`,
      [nr, condition, markt * 0.85, markt, markt * 1.2],
    );
    for (let tag = 60; tag >= 0; tag -= 3)
      await db.run(
        `INSERT INTO price_history (set_number, condition, currency_code, avg_price, qty_avg_price, recorded_at)
                    VALUES ($1,$2,'EUR',$3,$3, NOW() - ($4 || ' days')::interval) ON CONFLICT DO NOTHING`,
        [
          nr,
          condition,
          Math.round(markt * (0.9 + 0.1 * Math.sin(tag / 9) + (60 - tag) / 600) * 100) / 100,
          String(tag),
        ],
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
      await holdsPart(db, uid, teil, { setNumber: '10294-1', colorId: id, quantity: 12 });
    }
  }
  await holdsPart(db, uid, '3001', { colorId: 0, quantity: 250, preis: 0.12 });
  await db.run(
    `INSERT INTO minifigs_catalog (fig_number, fig_name) VALUES ('fig-000001', 'Marty McFly') ON CONFLICT DO NOTHING`,
  );
  await holdsMinifig(db, uid, 'fig-000001', { setNumber: '10300-1', quantity: 1 });
  await db.run(
    `INSERT INTO minifigs_catalog (fig_number, fig_name) VALUES ('fig-000002', 'Doc Brown') ON CONFLICT DO NOTHING`,
  );
  await holdsMinifig(db, uid, 'fig-000002', { quantity: 2, preis: 4.5 });
  // Via the service: only it encrypts the number, as the database requires.
  await require(path.join(__dirname, '..', '..', 'dist', 'src', 'vouchers', 'repository', 'vouchers.js')).insertVoucher(
    db,
    uid,
    { number: '6123-4567-8901', pin: '4711', amount: 50, currency: 'EUR' },
  );
  await db.run(
    `INSERT INTO price_alerts (user_id, set_number, condition, direction, threshold, currency_code)
                VALUES ($1, '10276-1', 'N', 'unter', 299, 'EUR') ON CONFLICT DO NOTHING`,
    [uid],
  );
  await db.run(`INSERT INTO storage_locations (user_id, name) VALUES ($1, 'Regal Keller')`, [uid]);
}

/**
 * patternCollection plus a linked sub-account “<account>_kind” that holds a set
 * of the collection at a different price: household rows, owner and
 * “unlink” thus get into the measured views. startApp also deletes
 * accounts with the prefix “<account>_”.
 */
async function patternHousehold(db, uid) {
  await patternCollection(db, uid);
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
  await holdsSet(db, kid, '21318-1', 1, { preis: 210, am: '2026-06-02T10:00:00Z' });
  return kid;
}

module.exports = {
  catalogSet,
  patternCollection,
  patternHousehold,
  holdsSet,
  record,
  quantityOf,
  haltRow,
  holdsPart,
  holdsMinifig,
  subsetOf,
  minifigQuantityOf,
};
