/**
 * Ein Verwalter setzt Passwort oder zweiten Faktor eines anderen Kontos zurück
 * (routes/auth/benutzer.ts, src/konto/verwalterAktionen.ts): Danach enden alle Sitzungen
 * und Tokens des Ziels. Ist das Ziel Verwalter (oder war es eben noch), gilt die Änderung
 * erst nach 24 Stunden, im Aufräumlauf, und eine Anmeldung des Ziels hebt sie auf.
 * Über die echten Routen und die Laufzeitrolle.
 *
 * Gegenproben (14.11.2026 gemessen, je einzeln):
 *   A  in zweitenFaktorEntfernen `zugaengeBeenden` gestrichen → rot: „ein normales Konto:
 *      sofort, Sitzungen und Tokens enden“ (Token und Sitzung des Ziels blieben)
 *   B  passwortDurchVerwalter ohne die Prüfung auf Verwalter (immer sofort) → rot:
 *      „ein Verwalterkonto: angekündigt …“ (kein wirksam_ab, Hash sofort neu), dazu
 *      „erst die Rolle entziehen …“ und „… wer die Rolle verlor …“
 *   C  in verwalterOderEbenGewesen nur noch is_admin → rot: „erst die Rolle entziehen …“
 *      (und daraus folgend „… wer die Rolle verlor …“)
 *   D  in angemeldetAntworten (routes/auth.ts) uebernahmenAbbrechen gestrichen → rot:
 *      „eine Anmeldung des Ziels hebt die Ankündigung auf“ (der Faktor fiel trotzdem)
 *   E  in nimmFaellige die Bedingung auf den noch aktiven Verwalter gestrichen → rot:
 *      „… wer die Rolle verlor, setzt nichts mehr durch“ (der Hash wurde ersetzt)
 *   F  im Aufräumlauf `zugaengeBeenden` gestrichen → rot: „… nach der Frist …“
 */
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';
process.env.APP_BASE_URL = 'http://localhost';
const S = require('./helpers/sources');
const _req = S.buildAndRequire();
const { datenOderSkip } = require('./helpers/db');
const { testServer } = require('./helpers/server');
const db = S.testDaten();
const { hashePasswort, passwortPasst } = _req('src/konto/passwortHash.js');
const zf = _req('src/konto/zweiterFaktor.js');
const { entschluessele } = _req('src/infra/geheimnis.js');
/** Ein echter zweiter Faktor; zurück kommen die Wiederherstellungscodes. */
async function mitFaktor(uid) {
  await S.alsKonto(uid, () => zf.beginneEinrichtung(uid));
  const z = await db.get('SELECT geheimnis FROM zweiter_faktor WHERE user_id = $1', [uid]);
  const geheim = zf.ausBase32(entschluessele(z.geheimnis, zf.faktorKontext(uid)));
  return S.alsKonto(uid, () => zf.bestaetigeEinrichtung(uid, zf.hotp(geheim, zf.zeitschritt())));
}
S.ersetzeDienste('mail', {
  mailEingerichtet: async () => false,
});

test('Verwalter übernimmt ein Konto', { concurrency: 1, timeout: 120_000 }, async t => {
  if (!(await datenOderSkip(t, _req))) return;
  const P = process.pid,
    PASS = 'Uebernahme-Pruefung-1',
    NEU = 'Neu-Gesetzt-Durch-Verwalter-1';
  const namen = ['chef', 'nutzer', 'vw', 'vw2', 'vw3'].map(n => `ueb_${n}_${P}`);
  await db.run('DELETE FROM users WHERE username = ANY($1)', [namen]);
  const hash = await hashePasswort(PASS);
  const konto = async (name, admin) =>
    (
      await db.get(
        `INSERT INTO users (username, password_hash, is_admin, is_active, email_verified)
         VALUES ($1, $2, $3, true, true) RETURNING id`,
        [name, hash, admin],
      )
    ).id;
  const [chef, nutzer, vw, vw2, vw3] = [
    await konto(namen[0], true),
    await konto(namen[1], false),
    await konto(namen[2], true),
    await konto(namen[3], true),
    await konto(namen[4], true),
  ];
  t.after(async () => {
    await db.run('DELETE FROM users WHERE username = ANY($1)', [namen]).catch(() => {});
    await db.run(`DELETE FROM user_sessions WHERE sid LIKE 'ueb-%'`).catch(() => {});
    await db.pool.end().catch(() => {});
  });

  const codes = await mitFaktor(chef);
  const { base } = testServer(_req, { sitzung: { userId: chef, username: namen[0], isAdmin: true }, t });
  const ruf = async (methode, weg, body) => {
    const r = await fetch(`${base}/api/v1/auth${weg}`, {
      method: methode,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...body, code: codes.shift() }),
    });
    return { status: r.status, body: await r.json() };
  };
  const zugaenge = async uid => {
    await db.run(`INSERT INTO api_tokens (token, user_id, expires_at) VALUES ($1, $2, NOW() + INTERVAL '1 day')`, [
      `ueb-${uid}-${Date.now()}`,
      uid,
    ]);
    await db.run(`INSERT INTO user_sessions (sid, sess, expire) VALUES ($1, $2, NOW() + INTERVAL '1 day')`, [
      `ueb-${uid}-${Date.now()}`,
      JSON.stringify({ userId: uid }),
    ]);
  };
  const stand = async uid => ({
    tokens: (await db.all('SELECT 1 FROM api_tokens WHERE user_id = $1', [uid])).length,
    sitzungen: (await db.all(`SELECT 1 FROM user_sessions WHERE sess::jsonb->>'userId' = $1`, [String(uid)])).length,
    faktor: (await db.all('SELECT 1 FROM zweiter_faktor WHERE user_id = $1', [uid])).length,
    neuesPasswort: await passwortPasst(
      NEU,
      (await db.get('SELECT password_hash FROM users WHERE id = $1', [uid])).password_hash,
    ),
  });
  const faktor = uid => db.run(`INSERT INTO zweiter_faktor (user_id, geheimnis, aktiv) VALUES ($1, 'x', true)`, [uid]);
  const faellig = async uid => {
    await db.run(`UPDATE verwalter_uebernahmen SET wirksam_ab = NOW() - INTERVAL '1 minute' WHERE ziel_id = $1`, [uid]);
    return S.testDienste().konto.fuehreFaelligeUebernahmenAus();
  };
  const offen = async uid => (await db.all('SELECT art FROM verwalter_uebernahmen WHERE ziel_id = $1', [uid])).length;

  await t.test('ein normales Konto: sofort, Sitzungen und Tokens enden', async () => {
    await faktor(nutzer);
    await zugaenge(nutzer);
    const f = await ruf('DELETE', `/users/${nutzer}/zweiter-faktor`, { admin_password: PASS });
    assert.deepEqual([f.status, f.body.wirksam_ab], [200, undefined]);
    assert.deepEqual(await stand(nutzer), { tokens: 0, sitzungen: 0, faktor: 0, neuesPasswort: false });
    await zugaenge(nutzer);
    const p = await ruf('PUT', `/users/${nutzer}/password`, { password: NEU, admin_password: PASS });
    assert.deepEqual([p.status, p.body.wirksam_ab], [200, undefined]);
    assert.deepEqual(await stand(nutzer), { tokens: 0, sitzungen: 0, faktor: 0, neuesPasswort: true });
  });

  await t.test('ein Verwalterkonto: angekündigt, wirksam erst nach der Frist, dann enden die Zugänge', async () => {
    await faktor(vw);
    await zugaenge(vw);
    const p = await ruf('PUT', `/users/${vw}/password`, { password: NEU, admin_password: PASS });
    const f = await ruf('DELETE', `/users/${vw}/zweiter-faktor`, { admin_password: PASS });
    for (const r of [p, f]) {
      assert.equal(r.status, 200, JSON.stringify(r.body));
      const stunden = (Date.parse(r.body.wirksam_ab) - Date.now()) / 3_600_000;
      assert.ok(stunden > 23.9 && stunden <= 24, `wirksam_ab ${r.body.wirksam_ab}`);
    }
    assert.deepEqual(await stand(vw), { tokens: 1, sitzungen: 1, faktor: 1, neuesPasswort: false });
    assert.equal(await S.testDienste().konto.fuehreFaelligeUebernahmenAus(), 0, 'vor der Frist');
    assert.equal(await faellig(vw), 2);
    assert.deepEqual(await stand(vw), { tokens: 0, sitzungen: 0, faktor: 0, neuesPasswort: true });
    assert.equal(await offen(vw), 0);
  });

  await t.test('erst die Rolle entziehen, dann übernehmen: trotzdem angekündigt', async () => {
    const r = await ruf('PUT', `/users/${vw2}/admin`, { is_admin: false, admin_password: PASS });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    const p = await ruf('PUT', `/users/${vw2}/password`, { password: NEU, admin_password: PASS });
    assert.ok(p.body.wirksam_ab, JSON.stringify(p.body));
    assert.equal((await stand(vw2)).neuesPasswort, false);
  });

  await t.test('eine Anmeldung des Ziels hebt die Ankündigung auf', async () => {
    const eigene = await mitFaktor(vw3);
    const f = await ruf('DELETE', `/users/${vw3}/zweiter-faktor`, { admin_password: PASS });
    assert.ok(f.body.wirksam_ab, JSON.stringify(f.body));
    const a = await fetch(`${base}/api/v1/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: namen[4], password: PASS, code: eigene[0], ohne_token: true }),
    });
    assert.equal(a.status, 200, await a.text());
    assert.equal(await offen(vw3), 0);
    await faellig(vw3);
    assert.equal((await stand(vw3)).faktor, 1, 'der Faktor fiel trotz Anmeldung');
  });

  await t.test('… wer die Rolle verlor, setzt nichts mehr durch', async () => {
    await db.run('UPDATE users SET is_admin = false WHERE id = $1', [chef]);
    try {
      assert.equal(await offen(vw2), 1);
      assert.equal(await faellig(vw2), 0);
      assert.equal(await offen(vw2), 0, 'die Ankündigung bleibt nicht liegen');
      assert.equal((await stand(vw2)).neuesPasswort, false);
    } finally {
      await db.run('UPDATE users SET is_admin = true WHERE id = $1', [chef]);
    }
  });
});
