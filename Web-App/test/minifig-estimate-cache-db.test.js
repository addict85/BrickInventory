/**
 * Der geschätzte Minifiguren-Marktpreis wird zwischengespeichert.
 *
 * ── Marcos Auftrag (Nachtrag 144) ───────────────────────────────────────────
 * „Der geschätzte Marktpreis einer Minifigur soll ebenfalls im Cache
 * gespeichert werden, damit er nicht jedes Mal neu geholt werden muss. Weiter
 * soll er auch sonst gespeichert werden, damit der Preisverlauf angezeigt
 * werden kann."
 *
 * ── Was fehlte ──────────────────────────────────────────────────────────────
 * GESCHRIEBEN wurde er längst — in minifig_price_cache UND
 * minifig_price_history. GELESEN nie.
 *
 * Jeder Aufruf holte deshalb erneut die Teile-Zusammensetzung von Rebrickable
 * und danach den BrickLink-Preis JE TEIL. Eine Minifigur mit fünfzehn Teilen
 * kostete fünfzehn Preisabfragen — bei jedem Öffnen der Finanzseite, für jede
 * Figur ohne BrickLink-Nummer.
 *
 * ── Zur Frist ───────────────────────────────────────────────────────────────
 * Dieselbe wie beim echten Abruf (`price_cache_ttl`, Vorgabe 24 h). Der Wert ist
 * derselbe Marktpreis, nur anders ermittelt — er soll nicht länger gelten als
 * ein von BrickLink geholter.
 *
 * Dass innerhalb der Frist KEIN neuer Verlaufspunkt entsteht, ist richtig und
 * kein Verlust: Ein zweiter Punkt mit demselben Wert am selben Tag trägt nichts
 * bei. Nach Ablauf wird neu gerechnet und geschrieben.
 */
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';

const _req = require('./helpers/sources').buildAndRequire();

async function neuerNutzer(db) {
  return db.get(
    `INSERT INTO users (username, password_hash) VALUES ('t_'||floor(random()*1e9),'x') RETURNING id`);
}

test('ein frischer Cache-Eintrag ersetzt die Neuberechnung', async (t) => {
  const db = _req('db/database.js');
  try { await db.initSchemaOnce(); }
  catch (e) {
    if (process.env.REQUIRE_DB === '1') throw e;
    t.skip('Test-DB nicht erreichbar'); return;
  }

  const mf = _req('routes/minifigs.js');
  const u = await neuerNutzer(db);
  const fig = 'fig-cache-test-01';

  await db.run('DELETE FROM minifig_price_cache WHERE fig_number = $1', [fig]);
  await db.run('DELETE FROM minifig_price_history WHERE fig_number = $1', [fig]);
  await db.run(
    `INSERT INTO minifig_price_cache (fig_number, condition, currency_code, avg_price, qty_avg_price)
     VALUES ($1,'N','EUR',3.50,3.50)`, [fig]);

  const t0 = Date.now();
  const wert = await mf.estimateFigPriceFromParts(fig, u.id, 'N');
  const dauer = Date.now() - t0;

  assert.equal(wert, 3.5,
    'Der zwischengespeicherte Wert wird nicht genommen — die Schätzung rechnet ' +
    'wieder alles neu, mit einer Preisabfrage je Teil.');
  assert.ok(dauer < 2000, `${dauer} ms — hier darf nichts über das Netz gehen`);

  const h = await db.get('SELECT COUNT(*)::int AS c FROM minifig_price_history WHERE fig_number = $1', [fig]);
  assert.equal(h.c, 0,
    'Innerhalb der Frist darf kein zweiter Verlaufspunkt entstehen — er trüge ' +
    'denselben Wert am selben Tag.');

  await db.run('DELETE FROM minifig_price_cache WHERE fig_number = $1', [fig]);
});

test('ein veralteter Eintrag wird übergangen', async (t) => {
  const db = _req('db/database.js');
  try { await db.initSchemaOnce(); }
  catch (e) {
    if (process.env.REQUIRE_DB === '1') throw e;
    t.skip('Test-DB nicht erreichbar'); return;
  }

  const mf = _req('routes/minifigs.js');
  const u = await neuerNutzer(db);
  const fig = 'fig-cache-test-02';

  await db.run('DELETE FROM minifig_price_cache WHERE fig_number = $1', [fig]);
  await db.run(
    `INSERT INTO minifig_price_cache (fig_number, condition, currency_code, avg_price, qty_avg_price, fetched_at)
     VALUES ($1,'N','EUR',3.50,3.50, NOW() - INTERVAL '48 hours')`, [fig]);

  // Ohne Netz liefert die Neuberechnung null — entscheidend ist, DASS sie
  // stattfindet statt den alten Wert zurückzugeben.
  const wert = await mf.estimateFigPriceFromParts(fig, u.id, 'N');
  assert.equal(wert, null,
    'Ein 48 Stunden alter Eintrag wurde genommen — dann altert der Marktpreis ' +
    'unbegrenzt und der Verlauf bekommt nie einen neuen Punkt.');

  await db.run('DELETE FROM minifig_price_cache WHERE fig_number = $1', [fig]);
  await db.pool.end().catch(() => {});
});

test('Cache und Verlauf werden beide beschrieben', () => {
  // Am Quelltext, weil ein echter Schreibvorgang einen BrickLink-Abruf
  // voraussetzt. Beide Tabellen gehören zusammen: Der Cache hält über sein
  // UNIQUE nur den letzten Wert, der Verlauf die Vergangenheit fürs Diagramm.
  const fs = require('node:fs');
  const path = require('node:path');
  const src = fs.readFileSync(path.join(__dirname, '..', 'routes', 'minifigs.ts'), 'utf8');
  const i = src.indexOf('async function estimateFigPriceFromParts');
  const fn = src.slice(i, src.indexOf('\n}', i));

  assert.match(fn, /INSERT INTO minifig_price_cache/, 'Die Schätzung landet nicht im Cache');
  assert.match(fn, /INSERT INTO minifig_price_history/, 'Die Schätzung landet nicht im Verlauf');
  assert.match(fn, /SELECT avg_price FROM minifig_price_cache/,
    'Der Cache wird nur beschrieben, nicht gelesen — genau der Zustand vor ' +
    'Nachtrag 144.');
});
