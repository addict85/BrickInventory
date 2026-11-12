/**
 * Scheitert der Katalogabgleich beim Start (kein Netz), meldet der Server
 * trotzdem „bereit“ — sonst bleibt der Startbildschirm stehen.
 *
 * Gegenprobe (am 28.10.2026 gemessen): die Bereitmeldung im catch-Zweig von
 * run() entfernt → rot: „ohne Netz ist der Server trotzdem bereit“.
 * Gegenprobe (30.10.2026): `throw e` im catch-Zweig durch `return` ersetzt →
 * rot: derselbe Test („Missing expected rejection“) — der Auftrag hielte den
 * gescheiterten Abgleich für erledigt und versuchte ihn erst am nächsten Tag.
 *
 * Gegenprobe (09.11.2026): in runWorker() das unlink aus dem finally-Zweig genommen → rot:
 *   „die Zwischendatei bleibt nach einem Fehlschlag nicht liegen“ (colors.csv.tmp blieb stehen).
 *
 * Voraussetzung: Test-DB via TEST_DATABASE_URL.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';

// Jeder Abruf scheitert sofort — wie ein Rechner ohne Netz.
const Module = require('node:module');
const _echtesRequire = Module.prototype.require;
Module.prototype.require = function (name, ...rest) {
  const m = _echtesRequire.call(this, name, ...rest);
  if (name.replace(/^node:/, '') === 'https')
    return {
      ...m,
      get: () => {
        const req = new EventEmitter();
        req.setTimeout = () => req;
        setImmediate(() => req.emit('error', new Error('getaddrinfo ENOTFOUND cdn.rebrickable.com')));
        return req;
      },
    };
  return m;
};

const _req = require('./helpers/sources').buildAndRequire();
const { dbOderSkip } = require('./helpers/db');
const db = _req('db/database.js');
const fs = require('node:fs');
const path = require('node:path');

// Mit `zwischendatei` legt der Download die Datei an und gelingt; den Import danach gibt es hier nicht.
let zwischendatei = false;
const quellen = require.resolve(path.join(__dirname, '..', 'dist', 'src/katalog/quellen.js'));
const echteQuellen = require(quellen);
require.cache[quellen].exports = Object.assign({}, echteQuellen, {
  ladeKatalogCsv: async (datei, ziel, o) => {
    if (!zwischendatei) return echteQuellen.ladeKatalogCsv(datei, ziel, o);
    fs.mkdirSync(path.dirname(ziel), { recursive: true });
    fs.writeFileSync(ziel, 'id,name\n1,Rot\n');
  },
});

test('Katalogabgleich ohne Netz', { concurrency: 1 }, async t => {
  if (!(await dbOderSkip(t, _req, { migrieren: false }))) return;
  const vorher =
    (await db.get(`SELECT wert AS value FROM laufzustand WHERE schluessel='rb_csv_last_sync'`))?.value ?? null;
  await db.run(`DELETE FROM laufzustand WHERE schluessel IN ('rb_csv_last_sync','startup_status')`);
  const zustand = _req('src/auftraege/startZustand.js');
  zustand.setzeStartZustand({ ready: false, step: 'CSV wird geladen...', progress: 0, total: 6 });
  try {
    await t.test('ohne Netz ist der Server trotzdem bereit', async () => {
      await assert.rejects(
        _req('src/katalog/csvAbgleich.js').run(),
        'der Auftrag soll den Fehler sehen und wiederholen',
      );
      assert.equal(zustand.startZustand().ready, true, JSON.stringify(zustand.startZustand()));
      const gespeichert = JSON.parse(
        (await db.get(`SELECT wert AS value FROM laufzustand WHERE schluessel='startup_status'`)).value,
      );
      assert.equal(gespeichert.ready, true, 'die anderen Worker lesen den Stand aus der Datenbank');
    });
    await t.test('die Zwischendatei bleibt nach einem Fehlschlag nicht liegen', async () => {
      const tmp = path.join(_req('src/infra/appPaths.js').DATA_DIR, 'colors.csv.tmp');
      zwischendatei = true;
      try {
        await assert.rejects(_req('src/katalog/csvAbgleich.js').run());
      } finally {
        zwischendatei = false;
      }
      assert.equal(fs.existsSync(tmp), false, `${tmp} liegt noch da`);
    });
  } finally {
    if (vorher !== null)
      await db.run(
        `INSERT INTO laufzustand (schluessel, wert) VALUES ('rb_csv_last_sync',$1)
                                       ON CONFLICT (schluessel) DO UPDATE SET wert = $1`,
        [vorher],
      );
    await db.pool.end().catch(() => {});
  }
});
