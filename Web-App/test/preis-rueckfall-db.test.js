/**
 * Finanzen: Ein gebrauchtes Set ohne Gebraucht-Preis bekommt den Preis für
 * „Neu" — auch wenn der nur noch alt im Cache liegt.
 *
 * Fall vom 25.10. (Holiday House, 2026): Für „Gebraucht" stand ein frischer
 * Eintrag ohne Preis, der Neu-Preis war älter als die Cache-Dauer. Die
 * Detailansicht zeigte ihn (sie liest jeden Cache-Eintrag), Finanzen zeigte
 * „—": fetchPrice sah im frischen Cache nach „Neu" nach und rief es nie ab.
 *
 * Gegenproben (am 25.10. gemessen):
 *   A  der Abruf des anderen Zustands im Null-Zweig entfernt (der Stand vor
 *      der Behebung) → rot: „kein Marktpreis"
 *   B  die Bedingung „beide frisch ohne Preis → nicht abrufen" entfernt →
 *      rot im dritten Fall (es kommt wieder ein Preis, weil erneut abgerufen
 *      wurde)
 *
 * Zweiter Fall: „BrickLink kennt dieses Set nicht" (catalog_cache NONE) galt
 * für immer. Ein neues Set, das beim ersten Nachschlagen noch nicht im
 * BrickLink-Katalog stand, bekam nie einen Marktpreis — mit grünem Haken.
 *   C  die Frist in ohneBricklinkPreis() entfernt → rot: „alte Markierung
 *      verhindert den Abruf"
 *
 * Voraussetzung: Test-DB via TEST_DATABASE_URL.
 */
const test   = require('node:test');
const assert = require('node:assert/strict');
const path   = require('node:path');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';

const ROOT = path.join(__dirname, '..');
const _req = require('./helpers/sources').buildAndRequire();
const db = _req('db/database.js');
const { haeltSet } = require('./helpers/bestand');

// BrickLink nachstellen — wie in preis-schreibweg-db: esbuild exportiert über
// Getter, also den Eintrag im require-Zwischenspeicher ersetzen.
const blPfad = require.resolve(path.join(ROOT, 'dist', 'clients/bricklink.js'));
const echt = require(blPfad);
let abrufe = [];
require.cache[blPfad].exports = Object.assign({}, echt, {
  getPriceGuide: async (_sn, cond) => {
    abrufe.push(cond);
    return cond === 'N'
      ? { min_price: '100', avg_price: '111', max_price: '120', qty_avg_price: '110', total_quantity: '7' }
      : { min_price: '0', avg_price: '0', max_price: '0', qty_avg_price: '0', total_quantity: '0' };
  },
});

/** Ein Konto mit einem gebrauchten Set, Währung EUR. */
async function konto(name, set) {
  await db.run('DELETE FROM users WHERE username = $1', [name]).catch(() => {});
  const uid = (await db.get(
    `INSERT INTO users (username, password_hash, is_active, email_verified) VALUES ($1, 'x', 1, 1) RETURNING id`, [name])).id;
  // Die Währung ausdrücklich: Ohne eigene Einstellung gälte die globale Vorgabe.
  await db.run(`INSERT INTO user_settings (user_id, key, value) VALUES ($1, 'currency', 'EUR')
                ON CONFLICT (user_id, key) DO UPDATE SET value = 'EUR'`, [uid]);
  await db.run(`INSERT INTO set_catalog (set_number, name, year) VALUES ($1, 'Rückfallprobe', 2026) ON CONFLICT DO NOTHING`, [set]);
  await haeltSet(db, uid, set, 1, { preis: 119, zustand: 'U' });
  return uid;
}

test('gebrauchtes Set ohne Gebraucht-Preis: Neu-Preis wird geholt', { concurrency: 1 }, async (t) => {
  try { await db.initSchema(); }
  catch (e) {
    if (process.env.REQUIRE_DB === '1')
      throw new Error(`REQUIRE_DB=1, aber die Test-DB ist nicht erreichbar: ${e.message}`);
    t.skip('Test-DB nicht erreichbar'); return;
  }
  const client = await db.pool.connect();
  try { await _req('db/migrate.js').runMigrations(client); } finally { client.release(); }

  const NAME = `rueckfall_${process.pid}`, SET = `9${process.pid % 10000}-1`;
  const aufraeumen = async () => {
    await db.run('DELETE FROM users WHERE username = $1', [NAME]).catch(() => {});
    for (const tab of ['price_cache', 'price_history', 'set_catalog', 'catalog_cache'])
      await db.run(`DELETE FROM ${tab} WHERE set_number = ANY($1)`, [[SET, SET.replace(/-1$/, '')]]).catch(() => {});
  };
  await aufraeumen();
  t.after(aufraeumen);

  const uid = await konto(NAME, SET);
  // Gebraucht: frisch, ohne Preis. Neu: Preis vorhanden, aber drei Tage alt.
  await db.run(`INSERT INTO price_cache (set_number, condition, currency_code, min_price, avg_price, max_price, qty_avg_price, total_quantity, fetched_at)
                VALUES ($1,'U','EUR',0,0,0,0,0,NOW()), ($1,'N','EUR',90,99,105,98,3,NOW() - INTERVAL '3 days')`, [SET]);

  const { computeSetsValuation } = _req('utils/financeCalc.js');
  abrufe = [];
  const zeile = (await computeSetsValuation(uid, [uid])).sets.find(s => s.set_number === SET);
  assert.ok(zeile, 'Set fehlt in der Bewertung');
  assert.equal(zeile.avg_price, 111, `kein Marktpreis: ${JSON.stringify({ avg: zeile.avg_price, no_price: zeile.no_price, abrufe })}`);
  assert.deepEqual(abrufe, ['N'], 'Gebraucht ist frisch geprüft und darf nicht erneut abgerufen werden');

  // Jetzt sind beide frisch — der nächste Aufruf kommt ohne BrickLink aus.
  abrufe = [];
  const zweite = (await computeSetsValuation(uid, [uid])).sets.find(s => s.set_number === SET);
  assert.equal(zweite.avg_price, 111);
  assert.deepEqual(abrufe, [], 'ruft BrickLink erneut ab, obwohl beide Zustände frisch im Cache liegen');

  // Beide frisch ohne Preis: kein Abruf, kein Preis.
  await db.run(`UPDATE price_cache SET avg_price = 0, min_price = 0, max_price = 0, qty_avg_price = 0, fetched_at = NOW() WHERE set_number = $1`, [SET]);
  abrufe = [];
  const dritte = (await computeSetsValuation(uid, [uid])).sets.find(s => s.set_number === SET);
  assert.equal(dritte.avg_price, 0);
  assert.deepEqual(abrufe, [], 'ruft BrickLink erneut ab, obwohl beide Zustände frisch ohne Preis sind');
});

test('„BrickLink kennt das Set nicht" gilt nur eine Weile', { concurrency: 1 }, async (t) => {
  t.after(() => db.pool.end().catch(() => {}));
  const NAME = `unbekannt_${process.pid}`, SET = `8${process.pid % 10000}-1`;
  const aufraeumen = async () => {
    await db.run('DELETE FROM users WHERE username = $1', [NAME]).catch(() => {});
    for (const tab of ['price_cache', 'price_history', 'set_catalog', 'catalog_cache'])
      await db.run(`DELETE FROM ${tab} WHERE set_number = $1`, [SET]).catch(() => {});
  };
  await aufraeumen();
  t.after(aufraeumen);
  const uid = await konto(NAME, SET);
  const { computeSetsValuation } = _req('utils/financeCalc.js');
  const bewerte = async () => (await computeSetsValuation(uid, [uid])).sets.find(s => s.set_number === SET);

  // Frisch markiert: kein Abruf, kein Preis, und der Grund steht dabei.
  await db.run(`INSERT INTO catalog_cache (set_number, name, bl_type, is_gear, fetched_at) VALUES ($1, 'x', 'NONE', 1, NOW())`, [SET]);
  abrufe = [];
  const frisch = await bewerte();
  assert.deepEqual(abrufe, [], 'frische Markierung: es wird trotzdem abgerufen');
  assert.equal(frisch.no_price, true);
  assert.equal(frisch.bl_unbekannt, true, 'der Grund fehlt — die Anzeige kann ihn nicht nennen');

  // Zehn Tage alt: Es wird wieder gefragt, und der Preis kommt an.
  await db.run(`UPDATE catalog_cache SET fetched_at = NOW() - INTERVAL '10 days' WHERE set_number = $1`, [SET]);
  abrufe = [];
  const alt = await bewerte();
  assert.ok(abrufe.length > 0, 'alte Markierung verhindert den Abruf — das Set bliebe für immer ohne Preis');
  assert.equal(alt.avg_price, 111);
});
