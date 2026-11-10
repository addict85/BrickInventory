/**
 * Eine Absage darf nicht heissen wie die Nutzlast: Die Einladung trägt ihren
 * Code im Feld `code`, eine Absage steht in `fehler` und kommt als 409 mit
 * Satz in der Sprache des Anfragenden zurück. Geprüft an den Haushaltsrouten
 * gegen die Datenbank, an fehlerText() und an der Haushaltskarte in jsdom.
 *
 * Gegenproben (10.11.2026 gemessen, je einzeln, zurückgenommen):
 *   A  die Invite-Route entscheidet an `'code' in r` statt `'fehler' in r` →
 *      rot: „Einladen liefert den Code als Nutzlast“ (der Erfolg wird zur
 *      Absage, 500 statt 200)
 *   B  redeemInvite() meldet `konto_mit_sich_selbst` unter `code` statt
 *      `fehler` → rot: „jede Absage beim Einlösen …“ (200 statt 409)
 *   C  in fehlerText() die Prüfung `if (!eintrag)` gestrichen → rot:
 *      „fehlerText fällt bei unbekanntem Code nicht um“ (TypeError)
 *   D  in speichereWaehrung() `await loadHousehold()` gestrichen (Bündel neu
 *      gebaut) → rot: „nach dem Währungswechsel …“ (Karte zeigt weiter EUR)
 */
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';

const _req = require('./helpers/sources').buildAndRequire();
const { dbOderSkip } = require('./helpers/db');
const { testServer } = require('./helpers/server');
const { oeffneOberflaeche, sicht, warte } = require('./helpers/oberflaeche');

test('Haushaltsrouten: Nutzlast und Absage', { concurrency: 1 }, async (t) => {
  const db = await dbOderSkip(t, _req);
  if (!db) return;
  const namen = [`absage_a_${process.pid}`, `absage_b_${process.pid}`, `absage_c_${process.pid}`];
  await db.run('DELETE FROM users WHERE username = ANY($1)', [namen]);
  const PASS = 'absage-Passwort-1', hash = require('../node_modules/bcryptjs').hashSync(PASS, 4);
  const ids = [];
  for (const n of namen)
    ids.push((await db.get('INSERT INTO users (username, password_hash) VALUES ($1,$2) RETURNING id', [n, hash])).id);
  const [a, b, c] = ids;
  // Konto c führt eine andere Währung: Die Absage trägt Platzhalter.
  await db.run(`INSERT INTO user_settings (user_id, key, value) VALUES ($1, 'currency', 'CHF')`, [c]);
  t.after(async () => {
    await db.run('DELETE FROM users WHERE id = ANY($1)', [ids]).catch(() => {});
    await db.pool.end().catch(() => {});
  });
  const routen = { '/api/v1': 'routes/api_v1/index.js' };
  const server = Object.fromEntries(ids.map(id => [id,
    testServer(_req, { sitzung: { userId: id }, apiNutzer: { user_id: id, is_admin: 0 }, routen, t }).base]));
  const post = async (id, pfad, rumpf = {}) => {
    const r = await fetch(`${server[id]}/api/v1/settings/household/${pfad}`, {
      method: 'POST', headers: { 'content-type': 'application/json', 'accept-language': 'de' }, body: JSON.stringify(rumpf) });
    return { status: r.status, body: await r.json() };
  };
  const einladung = async (id) => {
    const r = await post(id, 'invite');
    assert.equal(r.status, 200, JSON.stringify(r.body));
    return r.body.code;
  };
  /** Eine Absage: 409, der Code daneben, ein deutscher Satz ohne offene Platzhalter. */
  const absage = (r, code) => {
    assert.equal(r.status, 409, `${code}: ${JSON.stringify(r.body)}`);
    assert.equal(r.body.success, false);
    assert.equal(r.body.code, code);
    assert.ok(r.body.error && r.body.error !== code && !/[{}]/.test(r.body.error), `Kein Satz: ${r.body.error}`);
  };

  await t.test('Einladen liefert den Code als Nutzlast', async () => {
    const r = await post(a, 'invite');
    assert.equal(r.status, 200);
    assert.equal(r.body.success, true);
    assert.match(r.body.code, /\w{4}/, 'der Einladungscode fehlt');
    assert.equal(r.body.error, undefined);
  });

  await t.test('jede Absage beim Einlösen kommt als 409 mit Satz', async () => {
    absage(await post(b, 'redeem', { code: 'kurz', password: PASS }), 'einladungscode_ungueltig');
    absage(await post(b, 'redeem', { code: 'ABCD-EFGH-IJKL', password: PASS }), 'einladungscode_abgelaufen');
    absage(await post(a, 'redeem', { code: await einladung(a), password: PASS }), 'konto_mit_sich_selbst');
    const waehrung = await post(c, 'redeem', { code: await einladung(a), password: PASS });
    absage(waehrung, 'waehrung_ungleich');
    assert.match(waehrung.body.error, /CHF/, 'Die Währungen stehen nicht im Satz');

    const ok = await post(b, 'redeem', { code: await einladung(a), password: PASS });
    assert.equal(ok.status, 200, JSON.stringify(ok.body));
    assert.equal(ok.body.linked_to.id, a);
    absage(await post(b, 'redeem', { code: await einladung(a), password: PASS }), 'konto_bereits_verknuepft');
    absage(await post(a, 'redeem', { code: await einladung(b), password: PASS }), 'verknuepfung_erzeugt_kreis');
    // Die Vorprüfung sagt dasselbe, bevor jemand sein Passwort eingibt.
    absage(await post(a, 'redeem/pruefen', { code: await einladung(b) }), 'verknuepfung_erzeugt_kreis');
  });

  await t.test('eine abgesagte Einladung bleibt einlösbar', async () => {
    // Die Absage gibt den Code frei: Er war nicht der Fehler.
    const code = await einladung(c);
    absage(await post(a, 'redeem', { code, password: PASS }), 'waehrung_ungleich');
    await db.run(`DELETE FROM user_settings WHERE user_id = $1 AND key = 'currency'`, [c]);
    const r = await post(a, 'redeem', { code, password: PASS });
    assert.equal(r.status, 200, JSON.stringify(r.body));
  });
});

test('fehlerText fällt bei unbekanntem Code nicht um', () => {
  // Eine Fehlermeldung ist das Letzte, was selbst noch abstürzen darf.
  const { fehlerText } = _req('src/infra/fehlerTexte.js');
  const fehler = console.error;
  console.error = () => {};
  try {
    assert.equal(fehlerText('gibt_es_nicht', 'de'), 'gibt_es_nicht');
    assert.equal(fehlerText('gibt_es_nicht', 'en'), 'gibt_es_nicht');
  } finally { console.error = fehler; }
  assert.notEqual(fehlerText('einladungscode_abgelaufen', 'de'), 'einladungscode_abgelaufen', 'Vorbedingung: ein bekannter Code hat einen Satz');
});

test('nach dem Währungswechsel wird die Haushaltskarte neu gezeichnet', async () => {
  // Die Karte nennt die Währung; ohne Neuladen stünde bis zum nächsten Seitenaufruf die alte da.
  let waehrung = 'EUR';
  const { w, d, aufrufe } = await oeffneOberflaeche({
    '/v1/settings': (_u, o) => {
      if (o.method === 'POST') waehrung = JSON.parse(o.body).currency;
      return { success: true };
    },
    '/v1/settings/household': () => ({ success: true, currency: waehrung, parents: [], sub_accounts: [], former_links: [] }),
  });
  try {
    await sicht(w, 'profil');
    const karte = () => d.getElementById('household-state').textContent;
    assert.ok(await warte(() => /Währung: EUR/.test(karte())), `Karte vorher: ${karte()}`);
    const feld = d.getElementById('s-cur');
    feld.value = 'CHF';
    feld.dispatchEvent(new w.Event('change', { bubbles: true }));
    assert.ok(await warte(() => d.getElementById('confirm-modal').style.display === 'flex'), 'Rückfrage vor dem Wechsel');
    d.getElementById('cd-confirm').click();
    assert.ok(await warte(() => aufrufe.some(x => x.method === 'POST' && x.url.endsWith('/v1/settings'))), 'nicht gespeichert');
    assert.ok(await warte(() => /Währung: CHF/.test(karte())), `Karte nachher: ${karte()}`);
  } finally { w.close(); }
});
