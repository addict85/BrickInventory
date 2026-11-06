/**
 * GET /api/v1/settings/export/data über die echte Route: Das ZIP aus archiver
 * lässt sich entpacken, enthält alle fünf Dateien, und die Teile des Kontos
 * stehen darin. test/zip-export.test.js baut das Archiv nur nach; dieser Test
 * hält die Route über ein Heben von archiver oder seiner Abhängigkeiten.
 *
 * Gegenproben (01.11.2026 gemessen):
 *   A  in der Route `{ name: 'teile.csv' }` → `{ name: 'teil.csv' }` → rot:
 *      „alle fünf Dateien" (teil.csv statt teile.csv)
 *   B  archive.finalize() entfernt → rot: das Archiv endet nie, Zeitlimit 60 s
 *
 * Voraussetzung: Test-DB via TEST_DATABASE_URL.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';

const _req = require('./helpers/sources').buildAndRequire();
const { dbOderSkip } = require('./helpers/db');
const { testServer } = require('./helpers/server');
const db = _req('db/database.js');

test('der Datenexport liefert ein entpackbares ZIP mit den Daten des Kontos', { concurrency: 1, timeout: 60_000 }, async (t) => {
  if (!await dbOderSkip(t, _req)) return;

  const NAME = `export_zip_${process.pid}`;
  await db.run('DELETE FROM users WHERE username = $1', [NAME]);
  const uid = (await db.get(`INSERT INTO users (username, password_hash, is_active, email_verified)
    VALUES ($1, 'x', true, true) RETURNING id`, [NAME])).id;
  await db.run(`INSERT INTO parts (user_id, part_number, color_id, source) VALUES ($1, '3001zip', 5, 'manual')`, [uid]);
  await db.run(`INSERT INTO part_acquisitions (user_id, part_number, color_id, quantity) VALUES ($1, '3001zip', 5, 7)`, [uid]);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'export-zip-'));
  t.after(async () => {
    fs.rmSync(dir, { recursive: true, force: true });
    await db.run('DELETE FROM users WHERE id = $1', [uid]);
    await db.pool.end().catch(() => {});
  });

  const { base } = testServer(_req, { sitzung: { userId: uid }, routen: { '/api/v1': 'routes/api_v1/settings.js' }, t });
  const r = await fetch(`${base}/api/v1/settings/export/data`);
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('content-type'), 'application/zip');
  const zip = path.join(dir, 'export.zip');
  fs.writeFileSync(zip, Buffer.from(await r.arrayBuffer()));

  execFileSync('unzip', ['-q', '-o', zip, '-d', dir]);
  const dateien = fs.readdirSync(dir).filter(n => n.endsWith('.csv')).sort();
  assert.deepEqual(dateien, ['merkliste.csv', 'minifiguren.csv', 'preisalarme.csv', 'sets.csv', 'teile.csv'], 'alle fünf Dateien');
  const teile = fs.readFileSync(path.join(dir, 'teile.csv'), 'utf8');
  assert.ok(teile.startsWith('﻿'), 'BOM fehlt');
  assert.match(teile, /3001zip/);
});
