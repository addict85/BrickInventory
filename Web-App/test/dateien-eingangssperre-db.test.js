/**
 * Dateien und Bild-Proxy stehen vor dem Eingang von /api/v1; die Sperren
 * „Passwortwechsel nötig“ und „2. Faktor Pflicht für Verwalter“ gelten trotzdem.
 *
 * Gegenproben (am 08.11.2026 gemessen):
 *   A  eingangsSperre aus den beiden Datei-Routen in routes/datenDateien.ts
 *      gestrichen → rot: Uploads und Anleitungen in „Passwortwechsel“ und
 *      „Verwalter ohne zweiten Faktor“ (200 statt 403)
 *   B  eingangsSperre aus registerImgProxy gestrichen → rot: dieselben
 *      Teiltests beim Bild-Proxy (nicht mehr 403)
 *   C  Prüfung zweiterFaktorPflicht in eingangsSperre gestrichen → rot:
 *      „Verwalter ohne zweiten Faktor“, „Passwortwechsel“ bleibt grün
 *
 * REQUIRE_DB=1.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const WURZEL = fs.mkdtempSync(path.join(os.tmpdir(), 'datei-sperre-'));
fs.writeFileSync(path.join(WURZEL, 'package.json'), '{}');
process.env.APP_ROOT = WURZEL;
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';

const _req = require('./helpers/sources').buildAndRequire();
const { dbOderSkip } = require('./helpers/db');
const { testServer } = require('./helpers/server');
const db = _req('db/database.js');

const NAMEN = ['ds_normal', 'ds_wechsel', 'ds_chef', 'ds_chef2fa'].map(n => `${n}_${process.pid}`);

test('Dateien und Bild-Proxy: Eingangssperren', { concurrency: 1 }, async t => {
  if (!(await dbOderSkip(t, _req))) return;

  await db.run('DELETE FROM users WHERE username = ANY($1)', [NAMEN]);
  const ids = [];
  for (const n of NAMEN)
    ids.push(
      (
        await db.get(
          `INSERT INTO users (username, password_hash, is_active, email_verified)
                            VALUES ($1, 'x', true, true) RETURNING id`,
          [n],
        )
      ).id,
    );
  const [normal, wechsel, chef, chef2fa] = ids;
  await db.run('UPDATE users SET must_change_password = TRUE WHERE id = $1', [wechsel]);
  await db.run('UPDATE users SET is_admin = TRUE WHERE id = ANY($1)', [[chef, chef2fa]]);
  await db.run(`INSERT INTO zweiter_faktor (user_id, geheimnis, aktiv) VALUES ($1, 'x', TRUE)`, [chef2fa]);
  for (const id of ids) {
    fs.mkdirSync(path.join(WURZEL, 'data', 'uploads', String(id)), { recursive: true });
    fs.writeFileSync(path.join(WURZEL, 'data', 'uploads', String(id), 'a.pdf'), `pdf von ${id}`);
  }
  const SN = `8${process.pid % 100000}-1`;
  await db.run('INSERT INTO sets (user_id, set_number) VALUES ($1, $2)', [normal, SN]);
  fs.mkdirSync(path.join(WURZEL, 'data', 'instructions'), { recursive: true });
  fs.writeFileSync(path.join(WURZEL, 'data', 'instructions', `${SN}_1.pdf`), '%PDF-1.4');

  const sitzung = {};
  const { app, base } = testServer(_req, { sitzung, routen: { '/': 'routes/datenDateien.js' }, t });
  _req('routes/imgProxy.js').registerImgProxy(app);
  const hole = async (uid, weg) => {
    const k = await db.get('SELECT is_admin FROM users WHERE id = $1', [uid]);
    Object.assign(sitzung, { userId: uid, isAdmin: k.is_admin === true });
    delete sitzung.mussPasswortAendern;
    const r = await fetch(base + weg);
    return { status: r.status, body: await r.text() };
  };
  const bild = 'url=https%3A%2F%2Fcdn.rebrickable.com%2Fx.jpg';
  const wege = uid => [
    `/data/uploads/${uid}/a.pdf`,
    `/data/instructions/${SN}_1.pdf`,
    `/api/v1/img-proxy?${bild}`,
    `/api/img-proxy?${bild}`,
  ];

  t.after(async () => {
    await db.run('DELETE FROM users WHERE id = ANY($1)', [ids]).catch(() => {});
    await db.pool.end().catch(() => {});
    fs.rmSync(WURZEL, { recursive: true, force: true });
  });

  await t.test('Passwortwechsel nötig sperrt Dateien und Bild-Proxy', async () => {
    for (const weg of wege(wechsel)) {
      const r = await hole(wechsel, weg);
      assert.equal(r.status, 403, `${weg}: ${r.body}`);
      assert.match(r.body, /passwort_wechsel_noetig/, weg);
    }
  });

  await t.test('Verwalter ohne zweiten Faktor wird gesperrt', async () => {
    for (const weg of wege(chef)) {
      const r = await hole(chef, weg);
      assert.equal(r.status, 403, `${weg}: ${r.body}`);
      assert.match(r.body, /zweiter_faktor_pflicht/, weg);
    }
  });

  await t.test('gewöhnliches Konto und Verwalter mit zweitem Faktor kommen durch', async () => {
    assert.equal((await hole(normal, `/data/uploads/${normal}/a.pdf`)).status, 200);
    assert.equal((await hole(normal, `/data/instructions/${SN}_1.pdf`)).status, 200);
    assert.equal((await hole(chef2fa, `/data/uploads/${chef2fa}/a.pdf`)).status, 200);
    // 400 kommt erst vom Proxy selbst: Die Sperre liess den Verwalter durch.
    assert.equal((await hole(chef2fa, '/api/v1/img-proxy?url=http%3A%2F%2Fnein')).status, 400);
  });
});
