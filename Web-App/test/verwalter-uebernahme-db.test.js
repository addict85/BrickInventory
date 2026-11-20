/**
 * Ein Verwalter setzt Passwort oder zweiten Faktor eines anderen Kontos zurück, deaktiviert es,
 * entzieht die Rolle oder löscht es (routes/auth/benutzer.ts, src/account/adminActions.ts).
 * Ist das Ziel Verwalter (oder war es eben noch), gilt das erst nach 24 Stunden, im Aufräumlauf;
 * eine Anmeldung des Ziels (Passwort, Passkey, QR-Abholung) oder der Link aus seiner Mail hebt
 * es auf. Über die echten Routen und die Laufzeitrolle.
 *
 * Gegenproben (14.11.2026 gemessen, je einzeln):
 *   A  in removeSecondFactor `endAccesses` gestrichen → rot: „ein normales Konto:
 *      sofort, Sitzungen und Tokens enden“ (Token und Sitzung des Ziels blieben)
 *   B  passwordByAdmin ohne die Prüfung auf Verwalter (immer sofort) → rot:
 *      „ein Verwalterkonto: angekündigt …“ (kein effective_at, Hash sofort neu)
 *   C  in adminOrJustBeen nur noch is_admin → rot (16.11. neu gemessen): „Deaktivieren,
 *      Rolle entziehen und Löschen …“ (nach dem Entzug ein Passwort sofort statt angekündigt)
 *   D  in signedInResponses (routes/auth.ts) cancelTakeovers gestrichen → rot:
 *      „eine Anmeldung des Ziels hebt die Ankündigung auf“ (der Faktor fiel trotzdem)
 *   E  in takeDue die Bedingung auf den noch aktiven Verwalter gestrichen → rot:
 *      „… wer die Rolle verlor, setzt nichts mehr durch“ (der Hash wurde ersetzt)
 *   F  im Aufräumlauf `endAccesses` gestrichen → rot: „… nach der Frist …“
 * Gegenproben (16.11.2026 gemessen, je einzeln):
 *   G  in aktivSetzen (verwalterAktionen.ts) die Ankündigung gestrichen → rot: „Deaktivieren,
 *      Rolle entziehen und Löschen …“ (sofort deaktiviert, kein effective_at)
 *   H  in executeTeardown den Zweig `loeschen` auf deaktivieren gelenkt → rot: dieselbe Prüfung
 *      (das Konto blieb)
 *   I  redeemMailLink ohne Abbruch (nur Suche) → rot: „der Link aus der Mail …“
 *   J  in takeDue die Prüfung auf eine zugleich fällige Deaktivierung gestrichen → rot: „… fällt
 *      weg, wenn das Ziel deaktiviert wurde“ (Fall a, der Hash wurde ersetzt); die Prüfung auf den
 *      Protokolleintrag seit der Ankündigung gestrichen → rot: dieselbe Prüfung (Fall b)
 *   K  in routes/auth/qr.ts cancelTakeovers gestrichen → rot: „eine QR-Abholung …“
 *   L  accountsList ohne `angekuendigt` → rot: „die Kontenliste zeigt …“
 */
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';
process.env.APP_BASE_URL = 'http://localhost';
const S = require('./helpers/sources');
const _req = S.buildAndRequire();
const { dataOrSkip } = require('./helpers/db');
const { testServer } = require('./helpers/server');
const { bis } = require('./helpers/zeit');
const db = S.testData();
const { hashePassword, passwordFits } = _req('src/account/passwordHash.js');
const zf = _req('src/factors/secondFactor.js');
const { decrypt } = _req('src/infra/geheimnis.js');
/** Ein echter zweiter Faktor; zurück kommen die Wiederherstellungscodes. */
async function withFactor(uid) {
  await S.asAccount(uid, () => zf.beginSetup(uid));
  const z = await db.get('SELECT secret FROM second_factor WHERE user_id = $1', [uid]);
  const geheim = zf.fromBase32(decrypt(z.secret, zf.secondFactorContext(uid)));
  return S.asAccount(uid, () => zf.confirmSetup(uid, zf.hotp(geheim, zf.timeStep())));
}
const mails = [];
S.replaceServices('mail', {
  mailConfigured: async () => true,
  mailAccountNotice: async (an, _name, type, o) => {
    mails.push({ an, type, ...o });
    return { success: true };
  },
});

test('Verwalter übernimmt ein Konto', { concurrency: 1, timeout: 180_000 }, async t => {
  if (!(await dataOrSkip(t, _req))) return;
  const P = process.pid,
    PASS = 'Uebernahme-Pruefung-1',
    NEU = 'Neu-Gesetzt-Durch-Verwalter-1';
  const namen = ['chef', 'nutzer', 'vw', 'vw2', 'vw3', 'vw4', 'vw5', 'vw6', 'vw7', 'vw8', 'vw9', 'nutzer2'].map(
    n => `ueb_${n}_${P}`,
  );
  await db.run('DELETE FROM users WHERE username = ANY($1)', [namen]);
  const hash = await hashePassword(PASS);
  const konto = async (name, admin) =>
    (
      await db.get(
        `INSERT INTO users (username, email, password_hash, is_admin, is_active, email_verified)
         VALUES ($1, $1 || '@beispiel.de', $2, $3, true, true) RETURNING id`,
        [name, hash, admin],
      )
    ).id;
  const ids = [];
  for (const [i, n] of namen.entries()) ids.push(await konto(n, i !== 1 && i !== 11));
  const [chef, nutzer, vw, vw2, vw3, vw4, vw5, vw6, vw7, vw8, vw9, nutzer2] = ids;
  t.after(async () => {
    await db.run('DELETE FROM users WHERE username = ANY($1)', [namen]).catch(() => {});
    await db.run(`DELETE FROM user_sessions WHERE sid LIKE 'ueb-%'`).catch(() => {});
    await db.run(`DELETE FROM rate_limit_attempts`).catch(() => {});
    await db.pool.end().catch(() => {});
  });

  // Jede Verwalteraktion verbraucht einen Code; zehn reichen hier nicht, also weitere desselben Satzes.
  const codes = await withFactor(chef);
  const { searchValue } = _req('src/infra/geheimnis.js');
  for (let i = 0; i < 30; i++) {
    const c = `zusatz${String(i).padStart(4, '0')}abcdef`;
    await db.run('INSERT INTO second_factor_codes (user_id, code_hash) VALUES ($1, $2)', [
      chef,
      searchValue('zweiter-faktor-code', `${chef}:${c}`),
    ]);
    codes.push(c);
  }
  const { base } = testServer(_req, { sitzung: { userId: chef, username: namen[0], isAdmin: true }, t });
  const ruf = async (methode, weg, body, b = base) => {
    const r = await fetch(`${b}/api/v1/auth${weg}`, {
      method: methode,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...body, code: body?.code ?? codes.shift() }),
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
    faktor: (await db.all('SELECT 1 FROM second_factor WHERE user_id = $1', [uid])).length,
    neuesPasswort: await passwordFits(
      NEU,
      (await db.get('SELECT password_hash FROM users WHERE id = $1', [uid])).password_hash,
    ),
  });
  const konten = async uid => db.get('SELECT is_admin, is_active FROM users WHERE id = $1', [uid]);
  const faktor = uid => db.run(`INSERT INTO second_factor (user_id, secret, active) VALUES ($1, 'x', true)`, [uid]);
  const faellig = async uid => {
    await db.run(`UPDATE admin_takeovers SET effective_at = NOW() - INTERVAL '1 minute' WHERE target_id = $1`, [uid]);
    return _req('src/account/adminActions.js').runDueTakeoversFrom();
  };
  const offen = async uid =>
    (await db.all('SELECT type FROM admin_takeovers WHERE target_id = $1 ORDER BY type', [uid])).map(z => z.type);
  const inFrist = r => {
    assert.equal(r.status, 200, JSON.stringify(r.body));
    const hours = (Date.parse(r.body.effective_at) - Date.now()) / 3_600_000;
    assert.ok(hours > 23.9 && hours <= 24, `effective_at ${r.body.effective_at}`);
  };
  const abortLink = async uid => {
    const an = `${namen[ids.indexOf(uid)]}@beispiel.de`;
    const m = () => [...mails].reverse().find(x => x.type === 'uebernahme_angekuendigt' && x.an === an);
    await bis(() => m(), 1000);
    return m()?.abbruch;
  };

  await t.test('ein normales Konto: sofort, Sitzungen und Tokens enden', async () => {
    await faktor(nutzer);
    await zugaenge(nutzer);
    const f = await ruf('DELETE', `/users/${nutzer}/zweiter-faktor`, { admin_password: PASS });
    assert.deepEqual([f.status, f.body.effective_at], [200, undefined]);
    assert.deepEqual(await stand(nutzer), { tokens: 0, sitzungen: 0, faktor: 0, neuesPasswort: false });
    await zugaenge(nutzer);
    const p = await ruf('PUT', `/users/${nutzer}/password`, { password: NEU, admin_password: PASS });
    assert.deepEqual([p.status, p.body.effective_at], [200, undefined]);
    assert.deepEqual(await stand(nutzer), { tokens: 0, sitzungen: 0, faktor: 0, neuesPasswort: true });
    const a = await ruf('PUT', `/users/${nutzer2}/aktiv`, { is_active: false, admin_password: PASS });
    assert.deepEqual([a.status, a.body.effective_at, (await konten(nutzer2)).is_active], [200, undefined, false]);
  });

  await t.test('ein Verwalterkonto: angekündigt, wirksam erst nach der Frist, dann enden die Zugänge', async () => {
    await faktor(vw);
    await zugaenge(vw);
    const p = await ruf('PUT', `/users/${vw}/password`, { password: NEU, admin_password: PASS });
    const f = await ruf('DELETE', `/users/${vw}/zweiter-faktor`, { admin_password: PASS });
    for (const r of [p, f]) inFrist(r);
    assert.deepEqual(await stand(vw), { tokens: 1, sitzungen: 1, faktor: 1, neuesPasswort: false });
    assert.equal(await _req('src/account/adminActions.js').runDueTakeoversFrom(), 0, 'vor der Frist');
    assert.equal(await faellig(vw), 2);
    assert.deepEqual(await stand(vw), { tokens: 0, sitzungen: 0, faktor: 0, neuesPasswort: true });
    assert.deepEqual(await offen(vw), []);
  });

  await t.test('Deaktivieren, Rolle entziehen und Löschen eines Verwalters: angekündigt, dann wirksam', async () => {
    mails.length = 0;
    inFrist(await ruf('PUT', `/users/${vw4}/aktiv`, { is_active: false, admin_password: PASS }));
    inFrist(await ruf('PUT', `/users/${vw5}/admin`, { is_admin: false, admin_password: PASS }));
    inFrist(await ruf('DELETE', `/users/${vw6}`, { admin_password: PASS }));
    assert.deepEqual(
      [await konten(vw4), await konten(vw5), await konten(vw6)],
      [
        { is_admin: true, is_active: true },
        { is_admin: true, is_active: true },
        { is_admin: true, is_active: true },
      ],
      'vor der Frist ändert sich nichts',
    );
    assert.ok(await abortLink(vw4), 'das Ziel bekommt einen Abbruch-Link');
    const anAdmin = mails.filter(m => m.type === 'verwaltung_uebernahme_angekuendigt');
    assert.ok(anAdmin.length >= 3 && anAdmin.every(m => !m.abbruch), 'die übrigen Verwalter ohne Link');
    for (const uid of [vw4, vw5, vw6]) await faellig(uid);
    assert.deepEqual(
      [await konten(vw4), await konten(vw5), await konten(vw6)],
      [{ is_admin: true, is_active: false }, { is_admin: false, is_active: true }, undefined],
    );
    // Wer die Rolle eben verlor, zählt noch als Verwalter: Sonst entzöge man sie erst und übernähme dann sofort.
    inFrist(await ruf('PUT', `/users/${vw5}/password`, { password: NEU, admin_password: PASS }));
  });

  await t.test('erst die Rolle entziehen, dann übernehmen: beides angekündigt', async () => {
    inFrist(await ruf('PUT', `/users/${vw2}/admin`, { is_admin: false, admin_password: PASS }));
    inFrist(await ruf('PUT', `/users/${vw2}/password`, { password: NEU, admin_password: PASS }));
    assert.deepEqual(await offen(vw2), ['passwort', 'rolle_entziehen']);
    assert.equal((await stand(vw2)).neuesPasswort, false);
  });

  await t.test('eine Anmeldung des Ziels hebt die Ankündigung auf', async () => {
    const eigene = await withFactor(vw3);
    inFrist(await ruf('DELETE', `/users/${vw3}/zweiter-faktor`, { admin_password: PASS }));
    // Ein eigener Server: Die Anmeldung schriebe sonst in die Sitzung des Verwalters.
    const anmeldung = testServer(_req, { sitzung: {}, t }).base;
    const a = await fetch(`${anmeldung}/api/v1/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: namen[4], password: PASS, code: eigene[0], ohne_token: true }),
    });
    assert.equal(a.status, 200, await a.text());
    assert.deepEqual(await offen(vw3), []);
    await faellig(vw3);
    assert.equal((await stand(vw3)).faktor, 1, 'der Faktor fiel trotz Anmeldung');
  });

  await t.test('der Link aus der Mail bricht ohne Anmeldung ab, einmal', async () => {
    mails.length = 0;
    inFrist(await ruf('PUT', `/users/${vw7}/aktiv`, { is_active: false, admin_password: PASS }));
    inFrist(await ruf('PUT', `/users/${vw7}/password`, { password: NEU, admin_password: PASS }));
    const link = await abortLink(vw7);
    const abbrechen = token =>
      fetch(`${base}/api/v1/auth/uebernahme-abbrechen`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie: '' },
        body: JSON.stringify({ token }),
      }).then(async r => ({ status: r.status, body: await r.json() }));
    assert.equal((await abbrechen('falsch')).body.code, 'abbruch_link_ungueltig');
    assert.deepEqual(await offen(vw7), ['deaktivieren', 'passwort']);
    const r = await abbrechen(link);
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.deepEqual(await offen(vw7), []);
    assert.equal((await abbrechen(link)).body.code, 'abbruch_link_ungueltig', 'nur einmal');
    await faellig(vw7);
    assert.deepEqual(await konten(vw7), { is_admin: true, is_active: true });
  });

  await t.test('eine fällige Übernahme fällt weg, wenn das Ziel deaktiviert wurde', async () => {
    // a) Deaktivieren und Passwort werden zugleich fällig
    inFrist(await ruf('PUT', `/users/${vw8}/aktiv`, { is_active: false, admin_password: PASS }));
    inFrist(await ruf('PUT', `/users/${vw8}/password`, { password: NEU, admin_password: PASS }));
    await faellig(vw8);
    assert.deepEqual([(await konten(vw8)).is_active, (await stand(vw8)).neuesPasswort], [false, false]);
    // b) seit der Ankündigung auf anderem Weg deaktiviert
    inFrist(await ruf('PUT', `/users/${vw9}/password`, { password: NEU, admin_password: PASS }));
    await S.asAccount(chef, () => _req('src/account/adminActions.js').persistActive(chef, vw9, false), {
      verwalter: true,
    });
    await faellig(vw9);
    assert.equal((await stand(vw9)).neuesPasswort, false);
  });

  await t.test('eine QR-Abholung des Ziels hebt die Ankündigung auf', async () => {
    const eigene = await withFactor(vw);
    await db.run('UPDATE users SET password_hash = $2, must_change_password = false WHERE id = $1', [vw, hash]);
    inFrist(await ruf('PUT', `/users/${vw}/password`, { password: NEU, admin_password: PASS }));
    const version = (await db.get('SELECT session_version AS v FROM users WHERE id = $1', [vw])).v;
    const ziel = testServer(_req, {
      sitzung: { userId: vw, username: namen[2], isAdmin: true, sitzungsVersion: version },
      t,
    }).base.replace('localhost', '127.0.0.1');
    const qr = await ruf('POST', '/qr-token', { password: PASS, code: eigene[0] }, ziel);
    assert.equal(qr.status, 200, JSON.stringify(qr.body));
    const roh = (weg, body) =>
      fetch(`${ziel}/api/v1/auth${weg}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      }).then(async r => ({ status: r.status, body: await r.json() }));
    const m = await roh('/qr-login', { token: qr.body.token, label: 'Pixel Probe' });
    assert.equal(m.status, 200, JSON.stringify(m.body));
    const b = await roh(`/qr-kopplung/${qr.body.kopplung}/bestaetigen`, { code: m.body.code });
    assert.equal(b.status, 200, JSON.stringify(b.body));
    assert.deepEqual(await offen(vw), ['passwort']);
    const a = await roh('/qr-login/abholen', { abholung: m.body.abholung });
    assert.equal(a.status, 200, JSON.stringify(a.body));
    assert.deepEqual(await offen(vw), []);
  });

  await t.test('die Kontenliste zeigt angekündigte Änderungen mit Zeitpunkt', async () => {
    const r = await fetch(`${base}/api/v1/auth/users`).then(x => x.json());
    const z = r.users.find(u => u.id === vw2);
    assert.deepEqual(z.angekuendigt.map(a => a.type).sort(), ['passwort', 'rolle_entziehen']);
    assert.ok(z.angekuendigt.every(a => Date.parse(a.effective_at) > Date.now()));
  });

  await t.test('… wer die Rolle verlor, setzt nichts mehr durch', async () => {
    await db.run('UPDATE users SET is_admin = false WHERE id = $1', [chef]);
    try {
      assert.equal((await offen(vw2)).length, 2);
      assert.equal(await faellig(vw2), 0);
      assert.deepEqual(await offen(vw2), [], 'die Ankündigung bleibt nicht liegen');
      assert.deepEqual([(await stand(vw2)).neuesPasswort, (await konten(vw2)).is_admin], [false, true]);
    } finally {
      await db.run('UPDATE users SET is_admin = true WHERE id = $1', [chef]);
    }
  });
});
