/**
 * Formulare mit Datei haben Grenzen über die Dateigrösse hinaus: eine Datei,
 * höchstens 20 Felder zu je 64 KB. Ohne sie nahm multer beliebig viele Felder
 * zu je 1 MB und beliebig viele Dateien in den Speicher.
 *
 * Gegenprobe (01.11.2026 gemessen): `...FORMULAR_GRENZEN` aus allen multer-
 * Aufrufen entfernt → rot: „zu viele Felder …“ (Einstellungsimport mit 30
 * Feldern 200, Gutschein-PDF mit 100-KB-Feld 422 aus der PDF-Prüfung).
 *
 * Voraussetzung: Test-DB via TEST_DATABASE_URL.
 */
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';

const _req = require('./helpers/sources').buildAndRequire();
const { dbOderSkip } = require('./helpers/db');
const { testServer } = require('./helpers/server');
const db = _req('db/database.js');

test('Grenzen für Formulare mit Datei', { concurrency: 1 }, async t => {
  if (!(await dbOderSkip(t, _req))) return;
  const NAME = `formular_${process.pid}`;
  await db.run('DELETE FROM users WHERE username = $1', [NAME]);
  const uid = (await db.get(`INSERT INTO users (username, password_hash) VALUES ($1, 'x') RETURNING id`, [NAME])).id;
  t.after(async () => {
    await db.run('DELETE FROM users WHERE id = $1', [uid]);
    await db.pool.end().catch(() => {});
  });
  const { base } = testServer(_req, {
    sitzung: { userId: uid },
    apiNutzer: { user_id: uid, is_admin: 0 },
    routen: { '/api/v1': 'routes/api_v1/index.js' },
    t,
  });
  const datei = () => new Blob([JSON.stringify({ user_settings: { currency: 'CHF' } })], { type: 'application/json' });
  const sende = async (pfad, fd) => {
    const r = await fetch(base + pfad, { method: 'POST', body: fd });
    return [r.status, (await r.json()).code ?? null];
  };

  await t.test('Vorbedingung: der Einstellungsimport nimmt ein gewöhnliches Formular an', async () => {
    const fd = new FormData();
    fd.append('file', datei(), 'e.json');
    assert.deepEqual(await sende('/api/v1/settings/import', fd), [200, null]);
  });

  await t.test('zu viele Felder, zu grosse Felder, zwei Dateien: 400', async () => {
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
        await sende('/api/v1/settings/import', viele),
        await sende('/api/v1/vouchers/pdf', gross),
        await sende('/api/v1/settings/import', zwei),
      ],
      [
        [400, 'upload_ungueltig'],
        [400, 'upload_ungueltig'],
        [400, 'upload_ungueltig'],
      ],
    );
  });
});
