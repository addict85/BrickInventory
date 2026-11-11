/**
 * Die Rebrickable-Stufe der Wanted-Auflösung: Nur 404 heisst „unbekannt“, und
 * jeder andere Fehler beendet die Stufe mit Grund, statt die übrigen Posten
 * still als „nicht gefunden“ zu zählen. HTTP läuft über eine Attrappe von
 * https.get, das Kontingent über die echte Datenbank.
 *
 * Gegenproben (am 11.11.2026 gemessen):
 *   A  in blTeilZuRb() wieder `.catch(() => null)` an beiden rbGet-Aufrufen →
 *      rot: „ohne Schlüssel …“, „Serverfehler 500 …“, „Tageslimit …“
 *   B  in loeseUeberRebrickableAuf() wieder `catch { rbId = null; }` → rot:
 *      dieselben drei
 *   C  in rbGet() `if (status === 404) return null;` entfernt → rot: „404 ist
 *      unbekannt, der Lauf geht weiter“ (und „Tageslimit …“, Grund stoerung)
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const https = require('node:https');
const { EventEmitter } = require('node:events');
const { Readable } = require('node:stream');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';

const _req = require('./helpers/sources').buildAndRequire();
const { dbOderSkip } = require('./helpers/db');
const db = _req('db/database.js');

/** Jede Anfrage bekommt `status` mit leerem JSON-Körper. */
async function mitAntwort(status, lauf) {
  const echt = https.get;
  let anfragen = 0;
  // @ts-expect-error — Attrappe mit genau dem, was src/infra/abruf.ts benutzt.
  https.get = (_u, _o, beiAntwort) => {
    anfragen++;
    const r = Object.assign(Readable.from([Buffer.from('{}')]), { statusCode: status, headers: {} });
    // @ts-expect-error — kein vollständiges IncomingMessage
    setImmediate(() => beiAntwort(r));
    return Object.assign(new EventEmitter(), { destroy: () => {}, end: () => {} });
  };
  try {
    return { ergebnis: await lauf(), anfragen };
  } finally {
    https.get = echt;
  }
}

const posten = n =>
  Array.from({ length: n }, (_, i) => ({
    posten: { art: 'part', blId: `9${i}9${i}`, blFarbe: null, menge: 1, zustand: null, maxPreis: null },
    rbId: null,
    rbFarbe: null,
    rbFarbName: null,
    rbFarbHex: null,
    sicherheit: null,
    farbeOffen: false,
  }));

test('Wanted-Auflösung über Rebrickable bricht mit Grund ab', { concurrency: 1 }, async t => {
  if (!(await dbOderSkip(t, _req))) return;
  t.after(() => db.pool.end().catch(() => {}));
  const S = _req('src/einstellungen/settings.js');
  const k = _req('src/katalog/apiKontingent.js');
  const { loeseUeberRebrickableAuf } = _req('src/merkliste/wantedAufloesung.js');
  await db.run("DELETE FROM global_settings WHERE key = 'rebrickable_api_key'");

  await t.test('ohne Schlüssel: abgebrochen mit Grund kein_schluessel', async () => {
    const r = await loeseUeberRebrickableAuf(posten(3));
    assert.equal(r.abgebrochen, 'kein_schluessel');
    assert.equal(r.gefunden, 0);
  });

  await S.setGlobalSetting('rebrickable_api_key', 'testschluessel');
  await k.setzeKontingentZurueck('rebrickable');

  await t.test('404 ist unbekannt, der Lauf geht weiter', async () => {
    const { ergebnis, anfragen } = await mitAntwort(404, () => loeseUeberRebrickableAuf(posten(3)));
    assert.equal(ergebnis.abgebrochen, undefined);
    assert.equal(ergebnis.gefragt, 3);
    // Je Posten zwei Wege (Nummer selbst, dann der Filter).
    assert.equal(anfragen, 3 * 2);
  });

  await t.test('Serverfehler 500 ist kein „unbekannt“', async () => {
    const { ergebnis, anfragen } = await mitAntwort(500, () => loeseUeberRebrickableAuf(posten(3)));
    assert.equal(ergebnis.abgebrochen, 'stoerung');
    assert.equal(anfragen, 1, 'nach dem ersten Fehler weiter gefragt');
  });

  await t.test('Tageslimit: abgebrochen mit Grund kontingent', async () => {
    await db.run(`INSERT INTO global_settings (key, value) VALUES ('api_limit_rebrickable', '1')
                  ON CONFLICT (key) DO UPDATE SET value = '1'`);
    await k.setzeKontingentZurueck('rebrickable');
    const { ergebnis, anfragen } = await mitAntwort(404, () => loeseUeberRebrickableAuf(posten(3)));
    assert.equal(ergebnis.abgebrochen, 'kontingent');
    assert.equal(anfragen, 1, 'nur der eine Aufruf des Kontingents ging hinaus');
  });
});
