/**
 * Die Laufzeitrolle sieht in users nur das eigene Konto, die direkt verknüpften und die
 * getrennten, die die Haushaltsansicht nennt, und in account_links nur Verknüpfungen mit dem
 * eigenen Konto; Adressen und Links liest nur die Systemrolle (Migration 0121). Die Wege der
 * App, die fremde Namen brauchen (Einladung prüfen, Haushaltsansicht), gehen weiter.
 *
 * Gegenproben (16.11.2026 gemessen, je einzeln):
 *   A  in 0121 die Policy auf users durch `USING (true)` ersetzt → rot: „eingeschleustes SQL
 *      sieht nur eigenes Konto und Haushalt“ (alle vier Konten sichtbar)
 *   B  in 0121 die Policy `lesen` auf account_links unverändert (USING true) → rot: dieselbe
 *      Prüfung (die fremde Verknüpfung ist sichtbar)
 *   C  in 0121 das REVOKE der Adressspalten gestrichen → rot: „… Adressen nicht“
 *   D  in src/haushalt/haushalt.ts pruefeEinladung wieder mit repo.kontoName (Laufzeitrolle)
 *      → rot: „wer eingeladen wird, erfährt den Namen …“ (die Kennung statt des Namens)
 *   E  in 0121 household_former_links aus der Policy gestrichen → rot: „die Haushaltsansicht
 *      nennt Unterkonten und getrennte …“ (former_links leer)
 */
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';
const S = require('./helpers/sources');
const _req = S.buildAndRequire();
const { datenOderSkip } = require('./helpers/db');
const { testServer } = require('./helpers/server');
const db = S.testDaten();
const { alsAnfrage } = _req('src/infra/kontoKontext.js');

test('Konten nur im eigenen Haushalt', { concurrency: 1, timeout: 120_000 }, async t => {
  if (!(await datenOderSkip(t, _req))) return;
  const P = process.pid;
  const namen = ['haupt', 'unter', 'fremd', 'frueher', 'fremdunter'].map(n => `kz_${n}_${P}`);
  await db.run('DELETE FROM users WHERE username = ANY($1)', [namen]);
  const ids = [];
  for (const n of namen)
    ids.push(
      (
        await db.get(
          `INSERT INTO users (username, email, password_hash, is_active, email_verified)
           VALUES ($1, $1 || '@beispiel.de', 'x', true, true) RETURNING id`,
          [n],
        )
      ).id,
    );
  const [haupt, unter, fremd, frueher, fremdunter] = ids;
  await db.run('INSERT INTO account_links (main_user_id, sub_user_id) VALUES ($1, $2), ($3, $4)', [
    haupt,
    unter,
    fremd,
    fremdunter,
  ]);
  await db.run('INSERT INTO household_former_links (main_user_id, sub_user_id) VALUES ($1, $2)', [haupt, frueher]);
  t.after(async () => {
    await db.run('DELETE FROM users WHERE id = ANY($1)', [ids]).catch(() => {});
    await db.pool.end().catch(() => {});
  });
  const zugang = S.testZugang();
  const als = (uid, f) => alsAnfrage({ session: { userId: uid } }, f);

  await t.test('eingeschleustes SQL sieht nur eigenes Konto und Haushalt', async () => {
    const sicht = async uid => ({
      konten: (await als(uid, () => zugang.all('SELECT id FROM users WHERE id = ANY($1) ORDER BY id', [ids]))).map(
        z => z.id,
      ),
      links: (
        await als(uid, () =>
          zugang.all('SELECT main_user_id AS m FROM account_links WHERE main_user_id = ANY($1) ORDER BY 1', [ids]),
        )
      ).map(z => z.m),
    });
    assert.deepEqual(await sicht(haupt), { konten: [haupt, unter, frueher], links: [haupt] });
    assert.deepEqual(await sicht(unter), { konten: [haupt, unter], links: [haupt] });
    assert.deepEqual(await sicht(fremd), { konten: [fremd, fremdunter], links: [fremd] });
  });

  await t.test('… Adressen nicht, auch die eigene nicht; Namen nur am eigenen Konto', async () => {
    await assert.rejects(
      als(haupt, () => zugang.get('SELECT email FROM users WHERE id = $1', [haupt])),
      /permission denied/,
    );
    await als(haupt, () => zugang.run('UPDATE users SET first_name = $2 WHERE id = ANY($1)', [[haupt, unter], 'Neu']));
    const vornamen = await db.all('SELECT id, first_name FROM users WHERE id = ANY($1) ORDER BY id', [[haupt, unter]]);
    assert.deepEqual(
      vornamen.map(z => z.first_name),
      ['Neu', null],
    );
  });

  await t.test('wer eingeladen wird, erfährt den Namen des Einladenden', async () => {
    const haushalt = { ..._req('src/haushalt/haushalt.js'), ...S.testBereich('haushalt') };
    const { code } = await S.alsKonto(fremd, () => haushalt.einladungAnlegen(fremd));
    const { base } = testServer(_req, { sitzung: { userId: haupt, username: namen[0] }, t });
    const r = await fetch(`${base}/api/v1/settings/household/redeem/pruefen`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ code }),
    });
    const body = await r.json();
    assert.deepEqual([r.status, body.inviter?.username], [200, namen[2]], JSON.stringify(body));
  });

  await t.test('die Haushaltsansicht nennt Unterkonten und getrennte Konten beim Namen', async () => {
    const { base } = testServer(_req, { sitzung: { userId: haupt, username: namen[0] }, t });
    const body = await (await fetch(`${base}/api/v1/settings/household`)).json();
    assert.deepEqual(
      [body.sub_accounts?.map(k => k.username), body.former_links?.map(k => k.username)],
      [[namen[1]], [namen[3]]],
      JSON.stringify(body),
    );
  });
});
