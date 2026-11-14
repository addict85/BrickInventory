/**
 * Der Takt der Anleitungs-Warteschlange gilt echten Abrufen, nicht Durchgängen: Für ein
 * Set mit Anleitung fragt downloadSetInstructions keinen fremden Server.
 *
 * Gezählt werden die Abrufe selbst (jede Quelle der Dienste, jede http(s)-Anfrage),
 * keine Dauer: Die mass den Aufbau der Dienste und Verbindungen mit und riss unter Last.
 *
 * Gegenprobe (14.11.2026 gemessen): in downloadSetInstructions die Rückkehr bei
 * `existing > 0` gestrichen → rot („kein fremder Server“: scrapeInstructions und
 * brickset.getInstructions gezählt).
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const https = require('node:https');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';

const { buildAndRequire, testDaten, testQuellen } = require('./helpers/sources');
const _req = buildAndRequire();
const { keineDb } = require('./helpers/db');

test('ein bereits versorgtes Set löst keinen Abruf aus', async t => {
  const db = testDaten();
  try {
    await db.initSchemaOnce();
  } catch (e) {
    keineDb(t, e);
    return;
  }

  const abrufe = [];
  const nein = name => async () => {
    abrufe.push(name);
    throw new Error(`${name}: im Test kein Netz`);
  };
  testQuellen(t, {
    scrapeInstructions: nein('scrapeInstructions'),
    brickset: { getInstructions: nein('brickset.getInstructions') },
  });
  for (const [name, modul] of [
    ['http', http],
    ['https', https],
  ])
    for (const art of ['request', 'get']) {
      const echt = modul[art];
      t.mock.method(/** @type {any} */ (modul), art, (/** @type {any[]} */ ...a) => {
        abrufe.push(`${name}.${art}`);
        return echt.apply(modul, a);
      });
    }

  const ins = _req('src/katalog/instructions.js');
  const sn = '99999-1';
  // Auch wenn eine Prüfung scheitert: Ein offener Pool hielte die Datei bis zur Zeitgrenze.
  t.after(async () => {
    await db.run('DELETE FROM shared_instructions WHERE set_number = $1', [sn]).catch(() => {});
    await db.pool.end().catch(() => {});
  });
  await db.run('DELETE FROM shared_instructions WHERE set_number = $1', [sn]);
  await db.run(
    `INSERT INTO shared_instructions (set_number, url, description, local_path)
     VALUES ($1, 'http://example.invalid/a.pdf', 'A', '/data/instructions/a.pdf')`,
    [sn],
  );

  const anzahl = await ins.downloadSetInstructions(sn, null);

  assert.deepEqual(abrufe, [], 'kein fremder Server für ein versorgtes Set');
  assert.equal(ins.letzterAbrufWarExtern(), false, 'Der Takt darf nach diesem Durchgang nicht warten');
  assert.equal(anzahl, 1, 'Die vorhandene Anleitung wurde nicht gezählt');
});
