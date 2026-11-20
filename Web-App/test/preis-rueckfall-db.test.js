/**
 * Finanzen: Ein gebrauchtes Set ohne Gebraucht-Preis bekommt den Preis für
 * „Neu" — auch wenn der nur noch alt im Cache liegt.
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
 *   C  die Frist in withoutBricklinkPrice() entfernt → rot: „alte Markierung
 *      verhindert den Abruf"
 *
 * Seit 05.11.2026 liest die Bewertung nur den Cache; geholt wird im Auftrag
 * preise_nachladen (hier von Hand ausgeführt). Gegenprobe (gemessen):
 *   D  in setPriceFromStock() den Rückfall auf den anderen Zustand entfernt →
 *      rot: „kein Marktpreis“
 *
 * Voraussetzung: Test-DB via TEST_DATABASE_URL.
 */
require('./helpers/systemrahmen');
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';

const ROOT = path.join(__dirname, '..');
const { buildAndRequire, testData } = require('./helpers/sources');
const _req = buildAndRequire();
const { dataOrSkip } = require('./helpers/db');
const db = testData();
const { holdsSet, catalogSet } = require('./helpers/bestand');

// BrickLink nachstellen — wie in preis-schreibweg-db: esbuild exportiert über
// Getter, also den Eintrag im require-Zwischenspeicher ersetzen.
const blPath = require.resolve(path.join(ROOT, 'dist', 'src/katalog/bricklinkPreise.js'));
const echt = require(blPath);
let fetches = [];
require.cache[blPath].exports = Object.assign({}, echt, {
  priceGuideQuery: async (_k, _sn, cond) => {
    fetches.push(cond);
    return cond === 'N'
      ? { min_price: '100', avg_price: '111', max_price: '120', qty_avg_price: '110', total_quantity: '7' }
      : { min_price: '0', avg_price: '0', max_price: '0', qty_avg_price: '0', total_quantity: '0' };
  },
});

/** Führt den Auftrag aus, den die Bewertung für fehlende Preise eingestellt hat. */
async function nachladen() {
  const a = await db.get(
    `SELECT id, payload FROM jobs WHERE type = 'preise_nachladen' AND status = 'offen' ORDER BY id DESC LIMIT 1`,
  );
  if (!a) return false;
  const { preiseNachladen } = _req('src/finances/reloadPrices.js');
  await preiseNachladen(a.payload, { signal: new AbortController().signal, progress: async () => true });
  await db.run(`DELETE FROM jobs WHERE type = 'preise_nachladen'`);
  return true;
}

/** Ein Konto mit einem gebrauchten Set, Währung EUR. */
async function konto(name, set) {
  await db.run('DELETE FROM users WHERE username = $1', [name]).catch(() => {});
  const uid = (
    await db.get(
      `INSERT INTO users (username, password_hash, is_active, email_verified) VALUES ($1, 'x', true, true) RETURNING id`,
      [name],
    )
  ).id;
  // Die Währung ausdrücklich: Ohne eigene Einstellung gälte die globale Vorgabe.
  await db.run(
    `INSERT INTO user_settings (user_id, key, value) VALUES ($1, 'currency', 'EUR')
                ON CONFLICT (user_id, key) DO UPDATE SET value = 'EUR'`,
    [uid],
  );
  await catalogSet(db, set, { name: 'Rückfallprobe', year: 2026 });
  await holdsSet(db, uid, set, 1, { preis: 119, zustand: 'U' });
  return uid;
}

test('gebrauchtes Set ohne Gebraucht-Preis: Neu-Preis wird geholt', { concurrency: 1 }, async t => {
  if (!(await dataOrSkip(t, _req))) return;

  const NAME = `rueckfall_${process.pid}`,
    SET = `9${process.pid % 10000}-1`;
  const aufraeumen = async () => {
    await db.run('DELETE FROM users WHERE username = $1', [NAME]).catch(() => {});
    for (const tab of ['price_cache', 'price_history', 'set_catalog', 'catalog_cache'])
      await db.run(`DELETE FROM ${tab} WHERE set_number = ANY($1)`, [[SET, SET.replace(/-1$/, '')]]).catch(() => {});
  };
  await aufraeumen();
  t.after(aufraeumen);

  const uid = await konto(NAME, SET);
  // Gebraucht: frisch, ohne Preis. Neu: Preis vorhanden, aber drei Tage alt.
  await db.run(
    `INSERT INTO price_cache (set_number, condition, currency_code, min_price, avg_price, max_price, qty_avg_price, total_quantity, fetched_at)
                VALUES ($1,'U','EUR',0,0,0,0,0,NOW()), ($1,'N','EUR',90,99,105,98,3,NOW() - INTERVAL '3 days')`,
    [SET],
  );

  const { valueSets } = _req('src/finances/financeCalc.js');
  fetches = [];
  const vorher = await valueSets(uid, [uid]);
  assert.deepEqual(fetches, [], 'die Bewertung ruft selbst BrickLink ab');
  assert.equal(vorher.preise_ausstehend, 1, 'der fehlende Preis steht nicht als Auftrag an');
  assert.ok(await nachladen());
  const zeile = (await valueSets(uid, [uid])).sets.find(s => s.set_number === SET);
  assert.ok(zeile, 'Set fehlt in der Bewertung');
  assert.equal(
    zeile.avg_price,
    111,
    `kein Marktpreis: ${JSON.stringify({ avg: zeile.avg_price, no_price: zeile.no_price, fetches })}`,
  );
  assert.deepEqual(fetches, ['N'], 'Gebraucht ist frisch geprüft und darf nicht erneut abgerufen werden');

  // Jetzt sind beide frisch — der nächste Aufruf kommt ohne BrickLink aus.
  fetches = [];
  assert.equal(await nachladen(), false, 'ein frischer Preis stellt keinen Auftrag ein');
  const zweite = (await valueSets(uid, [uid])).sets.find(s => s.set_number === SET);
  assert.equal(zweite.avg_price, 111);
  assert.deepEqual(fetches, [], 'ruft BrickLink erneut ab, obwohl beide Zustände frisch im Cache liegen');

  // Beide frisch ohne Preis: kein Abruf, kein Preis.
  await db.run(
    `UPDATE price_cache SET avg_price = 0, min_price = 0, max_price = 0, qty_avg_price = 0, fetched_at = NOW() WHERE set_number = $1`,
    [SET],
  );
  fetches = [];
  const dritte = (await valueSets(uid, [uid])).sets.find(s => s.set_number === SET);
  assert.equal(await nachladen(), false, 'beide frisch ohne Preis: kein Auftrag');
  assert.equal(dritte.avg_price, 0);
  assert.deepEqual(fetches, [], 'ruft BrickLink erneut ab, obwohl beide Zustände frisch ohne Preis sind');
});

test('„BrickLink kennt das Set nicht" gilt nur eine Weile', { concurrency: 1 }, async t => {
  t.after(() => db.pool.end().catch(() => {}));
  const NAME = `unbekannt_${process.pid}`,
    SET = `8${process.pid % 10000}-1`;
  const aufraeumen = async () => {
    await db.run('DELETE FROM users WHERE username = $1', [NAME]).catch(() => {});
    for (const tab of ['price_cache', 'price_history', 'set_catalog', 'catalog_cache'])
      await db.run(`DELETE FROM ${tab} WHERE set_number = $1`, [SET]).catch(() => {});
  };
  await aufraeumen();
  t.after(aufraeumen);
  const uid = await konto(NAME, SET);
  const { valueSets } = _req('src/finances/financeCalc.js');
  const value = async () => (await valueSets(uid, [uid])).sets.find(s => s.set_number === SET);

  // Frisch markiert: kein Abruf, kein Preis, und der Grund steht dabei.
  await db.run(
    `INSERT INTO catalog_cache (set_number, bl_type, is_gear, fetched_at) VALUES ($1, 'NONE', true, NOW())`,
    [SET],
  );
  fetches = [];
  const frisch = await value();
  assert.deepEqual(fetches, [], 'frische Markierung: es wird trotzdem abgerufen');
  assert.equal(frisch.no_price, true);
  assert.equal(frisch.bl_unbekannt, true, 'der Grund fehlt — die Anzeige kann ihn nicht nennen');

  // Zehn Tage alt: Es wird wieder gefragt, und der Preis kommt an.
  await db.run(`UPDATE catalog_cache SET fetched_at = NOW() - INTERVAL '10 days' WHERE set_number = $1`, [SET]);
  fetches = [];
  await value();
  assert.ok(
    (await nachladen()) && fetches.length > 0,
    'alte Markierung verhindert den Abruf — das Set bliebe für immer ohne Preis',
  );
  const alt = await value();
  assert.equal(alt.avg_price, 111);
});
