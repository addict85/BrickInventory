/**
 * Forms with a file have limits beyond the file size: one file,
 * at most 20 fields of 64 KB each. Without them multer took arbitrarily many fields
 * of 1 MB each and arbitrarily many files into memory.
 *
 * Counter-check (measured 01.11.2026): `...FORM_LIMITS` removed from all multer
 * calls → red: “too many fields …” (settings import with 30
 * fields 200, voucher PDF with a 100 KB field 422 from the PDF check).
 *
 * Prerequisite: test DB via TEST_DATABASE_URL.
 */
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';

const { buildAndRequire, testData } = require('./helpers/sources');
const _req = buildAndRequire();
const { dataOrSkip } = require('./helpers/db');
const { testServer } = require('./helpers/server');
const db = testData();

test('limits for forms with a file', { concurrency: 1 }, async t => {
  if (!(await dataOrSkip(t, _req))) return;
  const NAME = `formular_${process.pid}`;
  await db.run('DELETE FROM users WHERE username = $1', [NAME]);
  const uid = (await db.get(`INSERT INTO users (username, password_hash) VALUES ($1, 'x') RETURNING id`, [NAME])).id;
  t.after(async () => {
    await db.run('DELETE FROM users WHERE id = $1', [uid]);
    await db.pool.end().catch(() => {});
  });
  const { base } = testServer(_req, { sitzung: { userId: uid }, t });
  const datei = () => new Blob([JSON.stringify({ user_settings: { currency: 'CHF' } })], { type: 'application/json' });
  const sende = async (path, fd) => {
    const r = await fetch(base + path, { method: 'POST', body: fd });
    return [r.status, (await r.json()).code ?? null];
  };

  await t.test('precondition: the settings import accepts an ordinary form', async () => {
    const fd = new FormData();
    fd.append('file', datei(), 'e.json');
    assert.deepEqual(await sende('/api/v2/settings/import', fd), [200, null]);
  });

  await t.test('too many fields, fields too large, two files: 400', async () => {
    const viele = new FormData();
    for (let i = 0; i < 30; i++) viele.append(`f${i}`, 'x');
    viele.append('file', datei(), 'e.json');
    const gross = new FormData();
    gross.append('notiz', 'x'.repeat(100 * 1024));
    gross.append('file', new Blob(['%PDF-1.4\n'], { type: 'application/pdf' }), 'g.pdf');
    const zwei = new FormData();
    zwei.append('file', datei(), 'e.json');
    zwei.append('file', datei(), 'f.json');
    assert.deepEqual(
      [
        await sende('/api/v2/settings/import', viele),
        await sende('/api/v2/vouchers/pdf', gross),
        await sende('/api/v2/settings/import', zwei),
      ],
      [
        [400, 'upload_invalid'],
        [400, 'upload_invalid'],
        [400, 'upload_invalid'],
      ],
    );
  });
});
