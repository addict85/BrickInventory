/**
 * Schlüsselwechsel: Geheimnisse unter Schlüssel A geschrieben, dann mit
 * DATA_KEY=B und DATA_KEY_ALT=A gestartet (schluesselWechsel wie im Start).
 * Danach liest B allein alles, A allein nichts mehr; der Suchwert der
 * Gutscheinnummer passt zu B. Wiederherstellungscodes von vor dem Wechsel
 * gelten, solange A als DATA_KEY_ALT bereitsteht.
 *
 * Gegenproben (05.11.2026 gemessen, je einzeln):
 *   A  in umschluesseln() den Zweig für v2 mit dem vorigen Schlüssel
 *      entfernt → rot: „B allein liest alles“ (API-Schlüssel, Faktor, PIN)
 *   B  in gutscheineNeuVerschluesseln() den Suchwert nicht neu → rot: „der
 *      Suchwert der Nummer …“
 *   C  pufferUmschluesseln() liefert immer undefined → rot: „B allein liest
 *      alles“ (Gutschein-PDF)
 *   D  in pruefeCode() den Rückfall auf suchwertAlt entfernt → rot: „ein
 *      Wiederherstellungscode von vor dem Wechsel …“
 *
 * Voraussetzung: Test-DB via TEST_DATABASE_URL.
 */
require('./helpers/systemrahmen');
const test = require('node:test');
const { umgebung } = require('./helpers/sources');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const WURZEL = fs.mkdtempSync(path.join(os.tmpdir(), 'schluesselwechsel-'));
fs.writeFileSync(path.join(WURZEL, 'package.json'), '{}');
umgebung({ APP_ROOT: WURZEL });
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';
const A = crypto.randomBytes(32).toString('base64'),
  B = crypto.randomBytes(32).toString('base64');
umgebung({ DATA_KEY: A });

const _req = require('./helpers/sources').buildAndRequire();
const { datenOderSkip } = require('./helpers/db');
const G = _req('src/infra/geheimnis.js');
const zf = _req('src/konto/zweiterFaktor.js');
const gut = {
  ..._req('src/gutscheine/repository/gutscheine.js'),
  ...require('./helpers/sources').testBereich('gutscheine').gutscheine,
};
const dateien = _req('src/gutscheine/gutscheinDateien.js');
const { schluesselWechsel } = _req('startup/datenbank.js');

/** Schlüssel umstellen, wie ein Neustart mit anderer Umgebung. */
function schluessel(aktuell, vorig) {
  umgebung({ DATA_KEY: aktuell });
  if (vorig) umgebung({ DATA_KEY_ALT: vorig });
  else umgebung({ DATA_KEY_ALT: undefined });
  G._vergissSchluessel();
}

test('Datenschlüssel wechseln', { concurrency: 1 }, async t => {
  const db = await datenOderSkip(t, _req);
  if (!db) return;
  const NAME = `wechsel_${process.pid}`;
  await db.run('DELETE FROM users WHERE username = $1', [NAME]);
  const uid = (
    await db.get(
      `INSERT INTO users (username, password_hash, is_active, email_verified)
    VALUES ($1, 'x', true, true) RETURNING id`,
      [NAME],
    )
  ).id;
  t.after(async () => {
    schluessel(A, null);
    await db.run(`DELETE FROM global_settings WHERE key = 'rebrickable_api_key'`).catch(() => {});
    await db.run('DELETE FROM users WHERE id = $1', [uid]).catch(() => {});
    await db.pool.end().catch(() => {});
    fs.rmSync(WURZEL, { recursive: true, force: true });
  });

  // ── unter A schreiben ────────────────────────────────────────────────────
  schluessel(A, null);
  const apiKontext = G.kontext('global_settings.value', 'rebrickable_api_key');
  await db.run(
    `INSERT INTO global_settings (key, value) VALUES ('rebrickable_api_key', $1)
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
    [G.verschluessele('api-geheim-123', apiKontext)],
  );
  const geheimnis = await zf.beginneEinrichtung(uid);
  const codes = await zf.bestaetigeEinrichtung(uid, zf.hotp(zf.ausBase32(geheimnis), zf.zeitschritt()));
  const g = await gut.gutscheinAnlegen(uid, { number: '6299-1234-5678', pin: '4711', amount: 25, currency: 'CHF' });
  const pdf = path.join(dateien.VOUCHER_DIR, String(uid), `${g.id}.pdf`);
  await dateien.schreibeGutscheinPdf(pdf, Buffer.from('%PDF-1.4 Gutschein'));

  /** Was der aktuelle Schlüssel lesen kann. */
  const liesAlles = async () => {
    const api = (await db.get(`SELECT value FROM global_settings WHERE key = 'rebrickable_api_key'`)).value;
    const faktor = (await db.get('SELECT geheimnis FROM zweiter_faktor WHERE user_id = $1', [uid])).geheimnis;
    const v = await db.get('SELECT number, pin, nummer_suche FROM vouchers WHERE id = $1', [g.id]);
    const datei = G.entschluesselePuffer(fs.readFileSync(pdf), G.kontext('gutschein-pdf', `${uid}/${g.id}.pdf`));
    return {
      api: G.entschluessele(api, apiKontext),
      faktor: G.entschluessele(faktor, zf.faktorKontext(uid)),
      nummer: G.entschluessele(v.number, gut.nummerKontext(uid, g.id)),
      pin: G.entschluessele(v.pin, gut.pinKontext(uid, g.id)),
      pdf: datei?.toString() ?? null,
      suchePasst: v.nummer_suche === gut.nummerSuche(uid, '6299-1234-5678'),
    };
  };
  const KLAR = {
    api: 'api-geheim-123',
    faktor: geheimnis,
    nummer: '6299-1234-5678',
    pin: '4711',
    pdf: '%PDF-1.4 Gutschein',
    suchePasst: true,
  };
  assert.deepEqual(await liesAlles(), KLAR, 'Vorbedingung: A liest alles');

  // ── Start mit B und dem vorigen A ────────────────────────────────────────
  schluessel(B, A);
  await t.test('ein Wiederherstellungscode von vor dem Wechsel gilt, solange A bereitsteht', async () => {
    assert.equal(await zf.pruefeCode(uid, codes[0]), 'wiederherstellung');
  });
  const warn = console.warn;
  console.warn = () => {};
  let geschrieben;
  try {
    geschrieben = await schluesselWechsel(require('./helpers/sources').testDienste());
  } finally {
    console.warn = warn;
  }

  await t.test('B allein liest alles, der Suchwert der Nummer passt zu B', async () => {
    schluessel(B, null);
    assert.deepEqual(await liesAlles(), KLAR);
    assert.ok(geschrieben >= 4, `nur ${geschrieben} Werte neu geschrieben`);
  });

  await t.test('A allein liest nichts mehr', async () => {
    schluessel(A, null);
    const warn2 = console.warn;
    console.warn = () => {};
    try {
      assert.deepEqual(await liesAlles(), {
        api: null,
        faktor: null,
        nummer: null,
        pin: null,
        pdf: null,
        suchePasst: false,
      });
    } finally {
      console.warn = warn2;
    }
  });
});
