/**
 * A refusal must not be named like the payload: the invitation carries its
 * code in the field `code`, a refusal stands in `fehler` and comes back as 409 with a
 * sentence in the language of the requester. Checked on the household routes
 * against the database, on errorText() and on the household card in jsdom.
 *
 * Counter-checks (measured 10.11.2026, each on its own, reverted):
 *   A  the invite route decides on `'code' in r` instead of `'fehler' in r` →
 *      red: “inviting returns the code as payload” (the success becomes a
 *      refusal, 500 instead of 200)
 *   B  redeemInvitation() reports `konto_mit_sich_selbst` under `code` instead of
 *      `fehler` → red: “every refusal on redeeming …” (200 instead of 409)
 *   C  the check `if (!eintrag)` deleted in errorText() → red:
 *      “errorText does not fall over on an unknown code” (TypeError)
 *   D  `await loadHousehold()` deleted in speichereWaehrung() (bundle
 *      rebuilt) → red: “after the currency change …” (card keeps showing EUR)
 */
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';

const { buildAndRequire } = require('./helpers/sources');
const _req = buildAndRequire();
const { dataOrSkip } = require('./helpers/db');
const { testServer } = require('./helpers/server');
const { openUi, sicht, warte } = require('./helpers/ui');

test('household routes: payload and refusal', { concurrency: 1 }, async t => {
  const db = await dataOrSkip(t, _req);
  if (!db) return;
  const namen = [`absage_a_${process.pid}`, `absage_b_${process.pid}`, `absage_c_${process.pid}`];
  await db.run('DELETE FROM users WHERE username = ANY($1)', [namen]);
  const PASS = 'absage-Passwort-1',
    hash = require('../node_modules/bcryptjs').hashSync(PASS, 4);
  const ids = [];
  for (const n of namen)
    ids.push((await db.get('INSERT INTO users (username, password_hash) VALUES ($1,$2) RETURNING id', [n, hash])).id);
  const [a, b, c] = ids;
  // Account c carries another currency: the refusal carries placeholders.
  await db.run(`INSERT INTO user_settings (user_id, key, value) VALUES ($1, 'currency', 'CHF')`, [c]);
  t.after(async () => {
    await db.run('DELETE FROM users WHERE id = ANY($1)', [ids]).catch(() => {});
    await db.pool.end().catch(() => {});
  });
  const server = Object.fromEntries(ids.map(id => [id, testServer(_req, { sitzung: { userId: id }, t }).base]));
  const post = async (id, pfad, rumpf = {}) => {
    const r = await fetch(`${server[id]}/api/v1/settings/household/${pfad}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'accept-language': 'de' },
      body: JSON.stringify(rumpf),
    });
    return { status: r.status, body: await r.json() };
  };
  const invitation = async id => {
    const r = await post(id, 'invite');
    assert.equal(r.status, 200, JSON.stringify(r.body));
    return r.body.code;
  };
  /** A refusal: 409, the code next to it, a German sentence without open placeholders. */
  const absage = (r, code) => {
    assert.equal(r.status, 409, `${code}: ${JSON.stringify(r.body)}`);
    assert.equal(r.body.success, false);
    assert.equal(r.body.code, code);
    assert.ok(r.body.error && r.body.error !== code && !/[{}]/.test(r.body.error), `Kein Satz: ${r.body.error}`);
  };

  await t.test('inviting returns the code as payload', async () => {
    const r = await post(a, 'invite');
    assert.equal(r.status, 200);
    assert.equal(r.body.success, true);
    assert.match(r.body.code, /\w{4}/, 'der Einladungscode fehlt');
    assert.equal(r.body.error, undefined);
  });

  await t.test('every refusal on redeeming comes as 409 with a sentence', async () => {
    absage(await post(b, 'redeem', { code: 'kurz', password: PASS }), 'einladungscode_ungueltig');
    absage(await post(b, 'redeem', { code: 'ABCD-EFGH-IJKL', password: PASS }), 'einladungscode_abgelaufen');
    absage(await post(a, 'redeem', { code: await invitation(a), password: PASS }), 'konto_mit_sich_selbst');
    const waehrung = await post(c, 'redeem', { code: await invitation(a), password: PASS });
    absage(waehrung, 'waehrung_ungleich');
    assert.match(waehrung.body.error, /CHF/, 'Die Währungen stehen nicht im Satz');

    const ok = await post(b, 'redeem', { code: await invitation(a), password: PASS });
    assert.equal(ok.status, 200, JSON.stringify(ok.body));
    assert.equal(ok.body.linked_to.id, a);
    absage(await post(b, 'redeem', { code: await invitation(a), password: PASS }), 'konto_bereits_verknuepft');
    absage(await post(a, 'redeem', { code: await invitation(b), password: PASS }), 'verknuepfung_erzeugt_kreis');
    // The pre-check says the same before anybody enters their password.
    absage(await post(a, 'redeem/pruefen', { code: await invitation(b) }), 'verknuepfung_erzeugt_kreis');
  });

  await t.test('a cancelled invitation stays redeemable', async () => {
    // The refusal releases the code: it was not the error.
    const code = await invitation(c);
    absage(await post(a, 'redeem', { code, password: PASS }), 'waehrung_ungleich');
    await db.run(`DELETE FROM user_settings WHERE user_id = $1 AND key = 'currency'`, [c]);
    const r = await post(a, 'redeem', { code, password: PASS });
    assert.equal(r.status, 200, JSON.stringify(r.body));
  });
});

test('errorText does not fall over on an unknown code', () => {
  // An error message is the last thing that may still crash itself.
  const { errorText } = _req('src/infra/errorTexts.js');
  const fehler = console.error;
  console.error = () => {};
  try {
    assert.equal(errorText('gibt_es_nicht', 'de'), 'gibt_es_nicht');
    assert.equal(errorText('gibt_es_nicht', 'en'), 'gibt_es_nicht');
  } finally {
    console.error = fehler;
  }
  assert.notEqual(
    errorText('einladungscode_abgelaufen', 'de'),
    'einladungscode_abgelaufen',
    'Vorbedingung: ein bekannter Code hat einen Satz',
  );
});

test('after the currency change the household card is redrawn', async () => {
  // The card names the currency; without reloading the old one would stand there until the next page call.
  let waehrung = 'EUR';
  const { w, d, aufrufe } = await openUi({
    '/v1/settings': (_u, o) => {
      if (o.method === 'POST') waehrung = JSON.parse(o.body).currency;
      return { success: true };
    },
    '/v1/settings/household': () => ({
      success: true,
      currency: waehrung,
      parents: [],
      sub_accounts: [],
      former_links: [],
    }),
  });
  try {
    await sicht(w, 'profile');
    const karte = () => d.getElementById('household-state').textContent;
    assert.ok(await warte(() => /Währung: EUR/.test(karte())), `Karte vorher: ${karte()}`);
    const feld = d.getElementById('s-cur');
    feld.value = 'CHF';
    feld.dispatchEvent(new w.Event('change', { bubbles: true }));
    assert.ok(
      await warte(() => d.getElementById('confirm-modal').style.display === 'flex'),
      'Rückfrage vor dem Wechsel',
    );
    d.getElementById('cd-confirm').click();
    assert.ok(
      await warte(() => aufrufe.some(x => x.method === 'POST' && x.url.endsWith('/v1/settings'))),
      'nicht gespeichert',
    );
    assert.ok(await warte(() => /Währung: CHF/.test(karte())), `Karte nachher: ${karte()}`);
  } finally {
    w.close();
  }
});
