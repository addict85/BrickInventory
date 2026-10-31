/**
 * Der nachgefüllte Marktpreis gilt dem Zustand DIESER Erfassung.
 *
 * Wird das Kaufpreisfeld geleert, füllt der Erfassungsdienst den Marktpreis
 * nach. Teile und Minifiguren liessen den Zustand der Zeile früher fallen und
 * leiteten einen aus ALLEN Erfassungen ab; eine Gebraucht-Zeile bekam so den
 * Preis des Sammelzustands.
 *
 * Gegenproben (am 30.10.2026 gemessen):
 *   A  in src/bestand/erfassungen.ts den Zustand an resolvePrice durch null
 *      ersetzt → rot bei „set“ (100 statt 60)
 *   B  in ARTEN.part.resolvePrice cond nicht weitergegeben → rot bei „part“
 *      (100 statt 60); „set“ bleibt grün
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { ohneKommentare } = require('./helpers/sources');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';
const _req = require('./helpers/sources').buildAndRequire();

test('ein geleerter Kaufpreis wird im Zustand der Zeile nachgefüllt', { concurrency: 1 }, async (t) => {
  const db = _req('db/database.js');
  try { await db.initSchema(); }
  catch (e) {
    if (process.env.REQUIRE_DB === '1')
      throw new Error(`REQUIRE_DB=1, aber die Test-DB ist nicht erreichbar: ${e.message}`);
    t.skip('Test-DB nicht erreichbar'); return;
  }
  const mc = await db.pool.connect();
  try { await _req('db/migrate.js').runMigrations(mc); } finally { mc.release(); }
  const { erfassungAendern } = _req('src/bestand/erfassungen.js');
  const P = process.pid;
  const NAME = `zustandpreis-${P}`, SN = `${P}9-1`, PN = `zp${P}`, FN = `fig-zp${P}`;
  const weg = async () => {
    await db.run('DELETE FROM users WHERE username = $1', [NAME]);
    await db.run('DELETE FROM price_cache WHERE set_number = $1', [SN]);
    await db.run('DELETE FROM part_price_cache WHERE part_number = $1', [PN]);
    await db.run('DELETE FROM minifig_price_cache WHERE fig_number = $1', [FN]);
  };
  await weg();
  t.after(async () => { await weg().catch(() => {}); await db.pool.end().catch(() => {}); });

  const uid = (await db.get(`INSERT INTO users (username,password_hash) VALUES ($1,'x') RETURNING id`, [NAME])).id;
  await db.run(`INSERT INTO user_settings (user_id, key, value) VALUES ($1,'currency','CHF')`, [uid]);
  // Neu 100, Gebraucht 60 — in allen drei Zwischenspeichern.
  for (const [z, preis] of [['N', 100], ['U', 60]]) {
    await db.run(`INSERT INTO price_cache (set_number, condition, currency_code, avg_price) VALUES ($1,$2,'CHF',$3)`, [SN, z, preis]);
    await db.run(`INSERT INTO part_price_cache (part_number, color_id, condition, currency_code, avg_price) VALUES ($1,77,$2,'CHF',$3)`, [PN, z, preis]);
    await db.run(`INSERT INTO minifig_price_cache (fig_number, condition, currency_code, avg_price) VALUES ($1,$2,'CHF',$3)`, [FN, z, preis]);
  }
  await db.run('INSERT INTO sets (user_id, set_number) VALUES ($1,$2)', [uid, SN]);
  await db.run(`INSERT INTO parts (user_id, part_number, color_id, source) VALUES ($1,$2,77,'manual')`, [uid, PN]);
  await db.run(`INSERT INTO minifigs (user_id, fig_number, source) VALUES ($1,$2,'manual')`, [uid, FN]);
  const zeile = async (sql, p) => (await db.get(sql + ` VALUES ($1,$2,1,10,'N','CHF') RETURNING id`, p)).id;
  const faelle = [
    ['set', 'set_acquisitions', 'purchase_price', [SN],
      await zeile('INSERT INTO set_acquisitions (user_id, set_number, quantity, purchase_price, condition, currency)', [uid, SN])],
    ['part', 'part_acquisitions', 'unit_price', [PN, 77],
      await db.get(`INSERT INTO part_acquisitions (user_id, part_number, color_id, quantity, unit_price, condition, currency)
                    VALUES ($1,$2,77,1,10,'N','CHF') RETURNING id`, [uid, PN]).then(r => r.id)],
    ['fig', 'minifig_acquisitions', 'unit_price', [FN],
      await zeile('INSERT INTO minifig_acquisitions (user_id, fig_number, quantity, unit_price, condition, currency)', [uid, FN])],
  ];
  for (const [art, tabelle, spalte, keys, id] of faelle) {
    await erfassungAendern(art, uid, id, keys, { [spalte]: '', condition: 'U' });
    const z = await db.get(`SELECT ${spalte}::float AS preis, price_estimated, condition FROM ${tabelle} WHERE id = $1`, [id]);
    assert.deepEqual(z, { preis: 60, price_estimated: true, condition: 'U' }, art);
  }
});

test('die Schätzung legt je Zustand einen eigenen Eintrag ab', () => {
  // Zwei Zustände = zwei Marktpreise. Lägen sie unter demselben Schlüssel,
  // überschriebe der eine den anderen und die zweite Zeile bliebe für immer
  // leer — genau Marcos Bild.
  const mf = fs.readFileSync(path.join(__dirname, '..', 'utils/marketPrice.ts'), 'utf8');
  const i = mf.indexOf('async function schaetzeFigurenpreis');
  const fn = mf.slice(i, mf.indexOf('\n}', i));

  assert.match(fn, /INSERT INTO minifig_price_cache[\s\S]{0,200}?condition/,
    'Der Cache-Eintrag trägt keinen Zustand');
  assert.match(fn, /fetchPartPrice\([^)]*cond[^)]*\)/,
    'Die Teilepreise werden nicht im Zustand dieser Schätzung geholt — dann ' +
    'ergäben „Neu" und „Gebraucht" denselben Wert.');
});

test('jeder Marktpreis-Abruf bekommt einen Zustand mit', () => {
  // ── Zweimal dieselbe Lücke (Nachträge 146 und 147) ────────────────────────
  //
  // 146 hat das BEARBEITEN behoben (resolvePrice in den Erfassungsrouten).
  // Marcos nächster Befund zeigte, dass das ERFASSEN denselben Fehler hatte:
  // Zwei heute angelegte Einträge derselben Figur, „Neu" und „Gebraucht",
  // beide Kaufpreis CHF 2.18 — obwohl die Marktpreise 2.18 und 2.20 sind.
  //
  // Beim Anlegen der zweiten Zeile gab es erst die erste; der ohne Zustand
  // geholte Preis leitete sich also aus ihr ab.
  //
  // Ich hatte beim ersten Mal nur die Stellen angesehen, die im Fehlerbericht
  // vorkamen. Diese Prüfung sieht ALLE — auch die, die noch niemand gemeldet
  // hat.
  const fs = require('node:fs');
  const path = require('node:path');
const { ohneKommentare } = require('./helpers/sources');
  const ROOT = path.join(__dirname, '..');

  const dateien = [];
  (function sammle(dir) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) sammle(p);
      else if (e.name.endsWith('.ts')) dateien.push(p);
    }
  })(path.join(ROOT, 'routes'));
  for (const d of ['src', 'utils']) {
    if (!fs.existsSync(path.join(ROOT, d))) continue;
    (function sammle(dir) {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) sammle(p);
        else if (e.name.endsWith('.ts')) dateien.push(p);
      }
    })(path.join(ROOT, d));
  }

  const treffer = [];
  for (const datei of dateien) {
    const code = ohneKommentare(fs.readFileSync(datei, 'utf8'));
    for (const fn of ['getCurrentFigMarketPrice', 'getCurrentPartMarketPrice']) {
      const re = new RegExp(String.raw`(?<!function )${fn}\(((?:[^()]|\([^()]*\))*)\)`, 'g');
      for (const m of code.matchAll(re)) {
        const args = m[1].split(',').map(a => a.trim()).filter(Boolean);
        if (args.length >= 4) continue;   // …, condition
        const zeile = code.slice(0, m.index).split('\n').length;
        treffer.push(`${path.relative(ROOT, datei)}:${zeile} ${fn}(${m[1].slice(0, 40)})`);
      }
    }
  }
  assert.deepEqual(treffer, [],
    'Marktpreis ohne Zustand geholt:\n  ' + treffer.join('\n  ') +
    '\nMarktpreise gelten JE ZUSTAND. Ohne Angabe wird einer aus den ' +
    'vorhandenen Erfassungen abgeleitet — und der stimmt nicht, sobald ein ' +
    'Eintrag in beiden Zuständen vorliegt.');
});
