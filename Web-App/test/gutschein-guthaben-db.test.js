/**
 * Die Guthaben-Abfrage über ihre echte Adresse — Schranke inbegriffen.
 * Ausführlich: docs/begruendungen/test/gutschein-guthaben-db.test.js.md#kopf
 */
const test   = require('node:test');
const assert = require('node:assert/strict');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';

const _req = require('./helpers/sources').buildAndRequire();
const db = _req('db/database.js');
const { testServer } = require('./helpers/server');
const G = _req('src/gutscheine/gutscheinGuthaben.js');
const S = _req('src/gutscheine/gutscheinGuthabenSchranke.js');

test.after(async () => { await db.pool.end().catch(() => {}); });

let HAUPT = 0, FREMD = 0;
let MIT_PIN = 0, OHNE_PIN = 0, FREMDER = 0;

const NUMMER = '5045076374450011166';
const PIN    = '5225';

// ── Der Ersatz für fetch ───────────────────────────────────────────────────
const protokoll = [];
/** Was die nächste Guthaben-Abfrage antworten soll. */
let naechsteAntwort = null;

function antwort({ status = 200, json = {}, text = '', kekse = [] } = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => (text || JSON.stringify(json)),
    json: async () => json,
    headers: { getSetCookie: () => kekse },
  };
}

function jwt(sekunden) {
  const kopf = Buffer.from('{"alg":"none"}').toString('base64url');
  const nutz = Buffer.from(JSON.stringify({
    exp: Math.floor(Date.now() / 1000) + sekunden })).toString('base64url');
  return `${kopf}.${nutz}.x`;
}

function guthaben(cent, waehrung = 'CHF', text = null) {
  return antwort({ json: { data: { giftCard: { balance: {
    centAmount: cent, currencyCode: waehrung,
    formattedAmount: text ?? `${waehrung} ${(cent / 100).toFixed(2)}`,
  } } } } });
}

G._ersetzeAbruf(async (url) => {
  const s = String(url);
  protokoll.push(s);
  if (s.includes('/gift-cards/balance')) return antwort({ text: '<html></html>' });
  if (s.includes('/Login')) return antwort({ kekse: [`gqauth=${jwt(3600)}; Path=/`] });
  return naechsteAntwort ?? guthaben(25000);
});
test.after(() => { G._ersetzeAbruf(null); });

/** Die Zahl der Abfragen an den Guthaben-Endpunkt (nicht Seite/Login). */
const abfragen = () => protokoll.filter(u => u.includes('giftCardBalanceQuery')).length;

async function aufbau() {
  await db.run('DROP SCHEMA public CASCADE');
  await db.run('CREATE SCHEMA public');
  await db.initSchema();
  const c = await db.pool.connect();
  try { await _req('db/migrate.js').runMigrations(c); } finally { c.release(); }
  await db.run(`INSERT INTO users (username,password_hash) VALUES ('haupt','x'),('fremd','x')`);
  HAUPT = (await db.get(`SELECT id FROM users WHERE username='haupt'`)).id;
  FREMD = (await db.get(`SELECT id FROM users WHERE username='fremd'`)).id;

  const { gutscheinAnlegen } = _req('src/gutscheine/dienst.js');
  MIT_PIN = (await gutscheinAnlegen(HAUPT, { number: NUMMER, pin: PIN, amount: 100, currency: 'CHF' })).id;
  OHNE_PIN = (await gutscheinAnlegen(HAUPT, { number: '5045076374450022277', pin: null, amount: 50, currency: 'CHF' })).id;
  FREMDER = (await gutscheinAnlegen(FREMD, { number: '9999999999999999999', pin: '0000', amount: 99, currency: 'CHF' })).id;
}

/** Die Schranke zurücksetzen — sonst steht jeder Fall im Schatten des vorigen. */
async function schrankeFrei() {
  await S.vergesseSchranke();
  G.vergesseSitzungen();
}

/**
 * Den Zeitpunkt des letzten Abrufs künstlich altern lassen.
 *
 * 30 Sekunden wirklich abzuwarten wäre ein Test, der eine halbe Minute
 * stillsteht — bei zwei Fällen eine Minute, und der Lauf hat 1400 Tests. Die
 * Uhr der Schranke steht in der Datenbank, also wird dort gealtert; geprüft
 * wird damit genau die Rechnung, die im Betrieb gilt.
 */
async function letzterAbrufVor(sekunden) {
  await db.run(
    `UPDATE gutschein_guthaben_schranke
        SET letzter_abruf = NOW() - make_interval(secs => $1) WHERE id = 1`, [sekunden]);
}

test('Guthaben: die Route und die Schranke', { concurrency: 1 }, async (t) => {
  try { await db.get('SELECT 1'); }
  catch (e) {
    if (process.env.REQUIRE_DB === '1')
      throw new Error(`REQUIRE_DB=1, aber die Test-DB ist nicht erreichbar: ${e.message}`);
    t.skip('Test-DB nicht erreichbar'); return;
  }
  await aufbau();

  const srv = testServer(_req, {
    sitzung: { userId: HAUPT }, apiNutzer: { user_id: HAUPT, is_admin: 0 },
    routen: { '/api/v1': 'routes/api_v1/index.js' }, t,
  });
  const fremdSrv = testServer(_req, {
    sitzung: { userId: FREMD }, apiNutzer: { user_id: FREMD, is_admin: 0 },
    routen: { '/api/v1': 'routes/api_v1/index.js' }, t,
  });

  const abfrage = (basis, id) =>
    fetch(`${basis}/api/v1/vouchers/${id}/guthaben`, { method: 'POST' });

  await t.test('1. der abgefragte Betrag landet im Feld Betrag', async () => {
    await schrankeFrei();
    naechsteAntwort = guthaben(25000, 'CHF', "CHF 250.00");
    const r = await abfrage(srv.base, MIT_PIN);
    const d = await r.json();
    assert.equal(r.status, 200, `Antwort ${r.status}: ${JSON.stringify(d)}`);
    assert.equal(d.voucher.amount, 250,
      'Marcos Vorgabe: „Der Zurückgemeldete Betrag soll im Feld Betrag ' +
      'gespeichert werden." 25000 Rappen sind 250.');
    assert.equal(d.angezeigt, 'CHF 250.00',
      'Der formatierte Text der Gegenseite geht MIT heraus — er ist die Form, ' +
      'in der es auf der LEGO-Seite stünde.');
    assert.equal(d.waehrung_geaendert, false);

    const z = await db.get('SELECT amount, currency, guthaben_geprueft_am, updated_at FROM vouchers WHERE id=$1',
      [MIT_PIN]);
    assert.equal(Number(z.amount), 250, 'In der Tabelle steht der neue Betrag');
    assert.equal(z.currency, 'CHF');
    assert.ok(z.guthaben_geprueft_am,
      'guthaben_geprueft_am ist leer. Ohne den Zeitpunkt ist „250 CHF" keine ' +
      'Auskunft — niemand weiss, von wann der Stand ist.');
    assert.ok(d.voucher.guthaben_geprueft_am,
      'Der Zeitpunkt muss auch HERAUS gehen, sonst kann die Oberfläche den ' +
      'Stand nicht zeigen.');
  });

  await t.test('2. die zweite Abfrage prallt an der Schranke ab — ohne einen Aufruf', async () => {
    const vorher = abfragen();
    const r = await abfrage(srv.base, MIT_PIN);
    const d = await r.json();
    assert.equal(r.status, 429, `Antwort ${r.status} statt 429: ${JSON.stringify(d)}`);
    assert.equal(d.grund, 'abstand');
    assert.ok(d.wartenSek > 0 && d.wartenSek <= S.ABSTAND_SEK,
      `wartenSek = ${d.wartenSek} — erwartet 1…${S.ABSTAND_SEK}`);
    assert.ok(/30/.test(d.error), `Der Satz nennt die Grenze nicht: ${d.error}`);
    assert.equal(abfragen(), vorher,
      'Es ging ein Aufruf hinaus, obwohl die Schranke zu war. Genau das ist ' +
      'Marcos Vorgabe: „maximal 1 Request pro 30sek".');
  });

  await t.test('3. die Grenze gilt ÜBER ALLE BENUTZER', async () => {
    // Marcos Nachtrag: „(über alle Benutzer)". Ein Zähler je Konto oder je
    // Arbeitsprozess wäre hier grün und in Wahrheit N-mal so hoch.
    const vorher = abfragen();
    const r = await abfrage(fremdSrv.base, FREMDER);
    const d = await r.json();
    assert.equal(r.status, 429,
      `Das FREMDE Konto bekam ${r.status}. Die Schranke zählt dann je Konto — ` +
      'bei zwei Konten wären es zwei Aufrufe in 30 Sekunden, bei zehn zehn.');
    assert.equal(d.grund, 'abstand');
    assert.equal(abfragen(), vorher, 'Und es ging dabei nichts hinaus');
  });

  await t.test('4. nach 31 Sekunden ist der Platz wieder frei', async () => {
    await letzterAbrufVor(31);
    naechsteAntwort = guthaben(12345);
    const r = await abfrage(srv.base, MIT_PIN);
    assert.equal(r.status, 200, `Antwort ${r.status} — der Platz müsste frei sein`);
    assert.equal(Number((await db.get('SELECT amount FROM vouchers WHERE id=$1', [MIT_PIN])).amount),
      123.45, 'Und der neue Betrag steht in der Tabelle');
  });

  await t.test('5. ohne PIN wird gar nicht gefragt — und der Platz bleibt frei', async () => {
    await schrankeFrei();
    const vorher = abfragen();
    const r = await abfrage(srv.base, OHNE_PIN);
    const d = await r.json();
    assert.equal(r.status, 400, `Antwort ${r.status}: ${JSON.stringify(d)}`);
    assert.equal(d.code, 'guthaben_pin_fehlt');
    assert.equal(abfragen(), vorher, 'Ohne PIN hat LEGO nichts zu antworten');
    // Und jetzt der eigentliche Punkt: Die Absage darf den einen Platz je
    // 30 Sekunden NICHT verbraucht haben.
    naechsteAntwort = guthaben(777);
    const r2 = await abfrage(srv.base, MIT_PIN);
    assert.equal(r2.status, 200,
      `Antwort ${r2.status} — eine Abfrage, die nie stattfand, hat den Platz ` +
      'belegt. Dann kostet jeder Gutschein ohne PIN eine halbe Minute.');
  });

  await t.test('6. ein fremder Gutschein ist nicht erreichbar', async () => {
    await schrankeFrei();
    const vorher = abfragen();
    const r = await abfrage(srv.base, FREMDER);
    assert.equal(r.status, 404,
      `Antwort ${r.status}. Ein Gutschein trägt Nummer und PIN — ein Fremdzugriff ` +
      'wäre die Weitergabe eines Zahlungsmittels.');
    assert.equal(abfragen(), vorher);
  });

  await t.test('7. ein unbekanntes Ausgabeland hält die Abfrage auf', async () => {
    await schrankeFrei();
    await db.run(
      `INSERT INTO global_settings (key,value) VALUES ('gutschein_land','de-XX')
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`);
    const vorher = abfragen();
    const r = await abfrage(srv.base, MIT_PIN);
    const d = await r.json();
    assert.equal(r.status, 400, `Antwort ${r.status}: ${JSON.stringify(d)}`);
    assert.equal(d.code, 'guthaben_land_ungueltig');
    assert.equal(abfragen(), vorher,
      'Es wurde mit einem Land gefragt, das es nicht gibt — die Adresse dafür ' +
      'existiert bei LEGO nicht, und die Absage gehört VOR den Aufruf.');
    await db.run(`DELETE FROM global_settings WHERE key='gutschein_land'`);
  });

  await t.test('8. das eingestellte Land geht wirklich mit', async () => {
    await schrankeFrei();
    await db.run(
      `INSERT INTO global_settings (key,value) VALUES ('gutschein_land','de-DE')
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`);
    protokoll.length = 0;
    naechsteAntwort = guthaben(5000, 'EUR');
    const r = await abfrage(srv.base, MIT_PIN);
    const d = await r.json();
    assert.equal(r.status, 200, `Antwort ${r.status}: ${JSON.stringify(d)}`);
    assert.ok(protokoll.some(u => u.includes('/de-de/gift-cards/balance')),
      `Die Guthabenseite wurde nicht für de-DE geladen: ${JSON.stringify(protokoll)}. ` +
      'Eine Karte gilt nur im Shop ihres Ausgabelandes — das Land ist keine Zierde.');
    // Und die Währung der Gegenseite gewinnt, aber nicht stillschweigend.
    assert.equal(d.voucher.currency, 'EUR');
    assert.equal(d.waehrung_geaendert, true,
      'Eine geänderte Währung ist eine geänderte Summe — sie muss gemeldet werden.');
    await db.run(`DELETE FROM global_settings WHERE key='gutschein_land'`);
    await db.run(`UPDATE vouchers SET currency='CHF' WHERE id=$1`, [MIT_PIN]);
  });

  await t.test('9. Bot-Schutz: die Abfrage ruht danach — auch für andere Konten', async () => {
    await schrankeFrei();
    naechsteAntwort = antwort({ status: 403, text: 'Attention Required! Cloudflare' });
    const r = await abfrage(srv.base, MIT_PIN);
    const d = await r.json();
    assert.equal(r.status, 429, `Antwort ${r.status}: ${JSON.stringify(d)}`);
    assert.equal(d.grund, 'botschutz');
    assert.ok(d.wartenSek > 60,
      `wartenSek = ${d.wartenSek} — eine Bot-Sperre ist keine Sache von Sekunden`);
    assert.ok(/Bot|bot/.test(d.error), `Der Satz sagt nicht, worum es geht: ${d.error}`);

    // Der Platz ist auch nach 31 Sekunden noch zu: Die SPERRE gilt, nicht der
    // Abstand. Genau das ist Marcos „dass nicht mehr Aufrufe generiert werden".
    await letzterAbrufVor(31);
    const vorher = abfragen();
    naechsteAntwort = guthaben(25000);
    const r2 = await abfrage(srv.base, MIT_PIN);
    const d2 = await r2.json();
    assert.equal(r2.status, 429, `Antwort ${r2.status}: ${JSON.stringify(d2)}`);
    assert.equal(d2.grund, 'botschutz', 'Nach einem Bot-Schutz-Treffer gilt die Pause');
    assert.equal(abfragen(), vorher, 'Und es geht dabei nichts hinaus');

    // Dasselbe für das fremde Konto — die Sperre ist installationsweit.
    const r3 = await abfrage(fremdSrv.base, FREMDER);
    assert.equal(r3.status, 429);
    assert.equal((await r3.json()).grund, 'botschutz');
    assert.equal(abfragen(), vorher);
  });

  await t.test('10. eine leergekaufte Karte: 0 wird gespeichert und bleibt änderbar', async () => {
    await schrankeFrei();
    naechsteAntwort = guthaben(0);
    const r = await abfrage(srv.base, MIT_PIN);
    const d = await r.json();
    assert.equal(r.status, 200, `Antwort ${r.status}: ${JSON.stringify(d)}`);
    assert.equal(d.voucher.amount, 0,
      'Eine Karte ohne Guthaben ist eine AUSKUNFT — „0" ist das Ergebnis, nicht ' +
      'ein Fehler der Abfrage.');

    // Und der Nachsatz, der ohne Nachmessen durchgerutscht wäre: pruefeWerte
    // weist amount <= 0 ab. Wer danach die PIN ändert, schickt keinen Betrag
    // mit — der gespeicherte 0 ginge durch dieselbe Prüfung.
    const p = await fetch(`${srv.base}/api/v1/vouchers/${MIT_PIN}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pin: '9999' }),
    });
    const pd = await p.json();
    assert.equal(p.status, 200,
      `Ändern antwortete ${p.status}: ${JSON.stringify(pd)} — eine leergekaufte ` +
      'Karte liesse sich dann nicht mehr bearbeiten.');
    assert.equal(pd.voucher.pin, '•••', 'nach aussen nur die Maske');
    const gespeichert = await db.get('SELECT user_id, pin FROM vouchers WHERE id=$1', [MIT_PIN]);
    assert.equal(_req('src/infra/geheimnis.js').entschluessele(gespeichert.pin,
      _req('src/gutscheine/repository/gutscheine.js').pinKontext(gespeichert.user_id, MIT_PIN)), '9999');
    assert.equal(pd.voucher.amount, 0, 'Und der Betrag bleibt, was er war');
    // Ein von Hand eingetippter Nullbetrag bleibt verboten.
    const n = await fetch(`${srv.base}/api/v1/vouchers/${MIT_PIN}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ amount: 0 }),
    });
    assert.equal(n.status, 400,
      'Eine selbst eingetragene 0 muss weiter durchfallen — sonst legt ein ' +
      'vergessenes Feld stillschweigend einen Gutschein über nichts an.');
  });

  await t.test('11. ein Fehler der Gegenseite wird gemeldet, nicht verschluckt', async () => {
    await schrankeFrei();
    // Die PIN wird AUS DER TABELLE gelesen und nicht aus der Konstanten oben:
    // Fall 10 hat sie auf „9999" geändert. Mein erster Entwurf nahm `PIN` und
    // meldete einen Leck, den es nicht gab — der Text enthielt eine Ziffernfolge,
    // die gar nicht mehr die PIN dieser Karte war. Die Zusicherung muss gegen
    // DEN Wert prüfen, den die Route an verdecke() gibt.
    const pinZeile = await db.get('SELECT user_id, pin FROM vouchers WHERE id=$1', [MIT_PIN]);
    const pinJetzt = _req('src/infra/geheimnis.js').entschluessele(pinZeile.pin,
      _req('src/gutscheine/repository/gutscheine.js').pinKontext(pinZeile.user_id, MIT_PIN));
    naechsteAntwort = antwort({ status: 500, text: `kaputt für ${NUMMER} mit ${pinJetzt}` });
    const r = await abfrage(srv.base, MIT_PIN);
    const d = await r.json();
    assert.equal(r.status, 502, `Antwort ${r.status}: ${JSON.stringify(d)}`);
    assert.equal(d.code, 'guthaben_fehlgeschlagen');
    assert.ok(!d.error.includes(pinJetzt),
      `Die PIN steht in der Antwort an den Browser: ${d.error}`);
    assert.ok(!d.error.includes(NUMMER),
      `Die ganze Kartennummer steht in der Antwort: ${d.error}`);
    assert.ok(d.error.includes('1166'),
      'Die letzten vier Ziffern dürfen stehen — sonst weiss niemand, welche Karte');

    // Der Platz IST verbraucht: Die Anfrage wurde abgesetzt.
    const vorher = abfragen();
    const r2 = await abfrage(srv.base, MIT_PIN);
    assert.equal(r2.status, 429,
      'Ein gescheiterter Aufruf muss den Platz verbrauchen — sonst liesse sich ' +
      'die Grenze durch wiederholtes Scheitern beliebig oft umgehen.');
    assert.equal(abfragen(), vorher);
  });

  // Gegenproben (02.11.2026 gemessen): die Prüfung kontoStand() aus belegePlatz()
  // entfernt → rot (200 statt 429); zaehleKonto() entfernt → rot („eine Abfrage
  // zählt für ihr Konto“); die Kontoprüfung NACH die Sperre gelegt → rot (grund
  // „botschutz“ statt „konto“).
  await t.test('12. die Grenze je Konto greift vor der für alle und vor dem Bot-Schutz', async () => {
    const zaehler = async (uid) => (await db.get('SELECT count FROM rate_limit_attempts WHERE key = $1',
      [`guthaben-konto|${uid}`]))?.count ?? 0;
    await db.run("DELETE FROM rate_limit_attempts WHERE key LIKE 'guthaben-konto|%'");
    await schrankeFrei();
    naechsteAntwort = guthaben(1000);
    assert.equal((await abfrage(srv.base, MIT_PIN)).status, 200);
    assert.equal(await zaehler(HAUPT), 1, 'eine Abfrage zählt für ihr Konto');

    await db.run('UPDATE rate_limit_attempts SET count = $2 WHERE key = $1', [`guthaben-konto|${HAUPT}`, S.KONTO_JE_STUNDE]);
    await schrankeFrei();
    await db.run(`UPDATE gutschein_guthaben_schranke SET sperre_bis = NOW() + INTERVAL '10 minutes' WHERE id = 1`);
    const vorher = abfragen();
    const r = await abfrage(srv.base, MIT_PIN);
    const d = await r.json();
    assert.equal(r.status, 429, JSON.stringify(d));
    assert.equal(d.grund, 'konto');
    assert.equal(d.code, 'zu_viele_anfragen');
    assert.ok(d.wartenSek > 0 && d.wartenSek <= 3600, String(d.wartenSek));
    assert.equal(abfragen(), vorher, 'trotz Grenze ging eine Abfrage hinaus');

    await schrankeFrei();
    naechsteAntwort = antwort({ status: 403, text: 'Bot' });
    assert.equal((await abfrage(srv.base, MIT_PIN)).status, 429);
    const s = await db.get('SELECT letzter_abruf, sperre_bis FROM gutschein_guthaben_schranke WHERE id = 1');
    assert.deepEqual(s, { letzter_abruf: null, sperre_bis: null }, 'das gesperrte Konto belegt den Platz oder löst die Pause aus');
    naechsteAntwort = guthaben(9900);
    const fremd = await abfrage(fremdSrv.base, FREMDER);
    assert.equal(fremd.status, 200, 'ein anderes Konto wird von der Grenze des ersten aufgehalten');
    await db.run("DELETE FROM rate_limit_attempts WHERE key LIKE 'guthaben-konto|%'");
  });
});
