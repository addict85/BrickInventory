/**
 * GET /api/v2/settings/export/data via the real route: the ZIP from archiver
 * can be unpacked, contains all five files, and the account's parts
 * are in it. test/zip-export.test.js only rebuilds the archive; this test
 * holds the route across an upgrade of archiver or its dependencies.
 *
 * Counter-checks (measured 01.11.2026):
 *   A  in the route `{ name: 'teile.csv' }` → `{ name: 'teil.csv' }` → red:
 *      “all five files" (teil.csv instead of teile.csv)
 *   B  archive.finalize() removed → red: the archive never ends, time limit 60 s
 *
 * Prerequisite: test DB via TEST_DATABASE_URL.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';

const { buildAndRequire, testData } = require('./helpers/sources');
const _req = buildAndRequire();
const { dataOrSkip } = require('./helpers/db');
const { testServer } = require('./helpers/server');
const db = testData();

test("the data export delivers an unpackable ZIP with the account's data", {
  concurrency: 1,
  timeout: 60_000,
}, async t => {
  if (!(await dataOrSkip(t, _req))) return;

  const NAME = `export_zip_${process.pid}`;
  await db.run('DELETE FROM users WHERE username = $1', [NAME]);
  const uid = (
    await db.get(
      `INSERT INTO users (username, password_hash, is_active, email_verified)
    VALUES ($1, 'x', true, true) RETURNING id`,
      [NAME],
    )
  ).id;
  await db.run(`INSERT INTO parts (user_id, part_number, color_id, source) VALUES ($1, '3001zip', 5, 'manual')`, [uid]);
  await db.run(
    `INSERT INTO part_acquisitions (user_id, part_number, color_id, quantity) VALUES ($1, '3001zip', 5, 7)`,
    [uid],
  );
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'export-zip-'));
  t.after(async () => {
    fs.rmSync(dir, { recursive: true, force: true });
    await db.run('DELETE FROM users WHERE id = $1', [uid]);
    await db.pool.end().catch(() => {});
  });

  const { base } = testServer(_req, { sitzung: { userId: uid }, t });
  const r = await fetch(`${base}/api/v2/settings/export/data`);
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('content-type'), 'application/zip');
  const zip = path.join(dir, 'export.zip');
  fs.writeFileSync(zip, Buffer.from(await r.arrayBuffer()));

  execFileSync('unzip', ['-q', '-o', zip, '-d', dir]);
  const dateien = fs
    .readdirSync(dir)
    .filter(n => n.endsWith('.csv'))
    .sort();
  assert.deepEqual(
    dateien,
    ['merkliste.csv', 'minifiguren.csv', 'preisalarme.csv', 'sets.csv', 'teile.csv'],
    'alle fünf Dateien',
  );
  const parts = fs.readFileSync(path.join(dir, 'teile.csv'), 'utf8');
  assert.ok(parts.startsWith('﻿'), 'BOM fehlt');
  assert.match(parts, /3001zip/);
});
