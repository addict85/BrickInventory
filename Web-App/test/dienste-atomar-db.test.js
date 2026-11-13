/**
 * Mehrstufige Schreibvorgänge der Dienste sind atomar: Konto und Protokoll,
 * Gutscheinzeile und PDF, Lesen und Schreiben beim Ändern eines Gutscheins.
 *
 * Gegenproben (13.11.2026 gemessen, je einzeln, dist neu gebaut):
 *   A  legeKontoAn (src/konto/konten.ts) ohne db.transaction, der Rumpf direkt →
 *      rot: „scheitert der Protokolleintrag, gibt es kein Konto“
 *   B  aktivSetzen (src/konto/verwalterAktionen.ts) ohne mitZugangsende → rot:
 *      „… bleibt das Konto aktiv“
 *   C  gutscheinMitPdfAnlegen (src/gutscheine/dienst.ts) ohne das Löschen im
 *      catch → rot: „… keine verwaiste Datei“
 *   D  gutscheinMitPdfAnlegen ohne db.transaction → rot: „… keine Gutscheinzeile“
 *   E  gutscheinBearbeiten liest mit gutschein() statt gutscheinGesperrt() → rot:
 *      „zwei gleichzeitige Änderungen“ (der Betrag des ersten ging verloren)
 *
 * Voraussetzung: Test-DB via TEST_DATABASE_URL.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';

const quellen = require('./helpers/sources');
const _req = quellen.buildAndRequire();
const { zugangOderSkip } = require('./helpers/db');

/** Vor dem Laden der Dienste: Sie halten das Modulobjekt, das sie beim Laden bekommen. */
const ersetze = (rel, zusatz) => {
  const pfad = require.resolve(path.join(quellen.DIST, rel));
  _req(rel);
  require.cache[pfad].exports = Object.assign({}, require.cache[pfad].exports, zusatz);
};
const stoerung = { protokoll: false, pdfMerken: false, pdfSchreiben: false };
const kaputt = was => {
  throw new Error(`Störung: ${was}`);
};
const echtProtokoll = _req('src/konto/repository/protokoll.js');
ersetze('src/konto/repository/protokoll.js', {
  protokolliere: (...a) => (stoerung.protokoll ? kaputt('protokoll') : echtProtokoll.protokolliere(...a)),
});
const echtDateien = _req('src/gutscheine/gutscheinDateien.js');
ersetze('src/gutscheine/gutscheinDateien.js', {
  schreibeGutscheinPdf: (...a) => (stoerung.pdfSchreiben ? kaputt('pdf') : echtDateien.schreibeGutscheinPdf(...a)),
});

/** Zwei Leser: Der erste wartet nach dem Lesen, bis der zweite zu lesen begonnen
 * hat. Ohne Zeilensperre lesen dann beide denselben alten Stand. */
let schranke = null;
const echtRepo = _req('src/gutscheine/repository/gutscheine.js');
const mitSchranke =
  name =>
  async (...a) => {
    const s = schranke;
    const ich = s ? ++s.n : 0;
    if (ich === 2) s.zweiterDa();
    const z = await echtRepo[name](...a);
    if (ich === 1) await s.zweiter;
    return z;
  };
ersetze('src/gutscheine/repository/gutscheine.js', {
  gutschein: mitSchranke('gutschein'),
  gutscheinGesperrt: mitSchranke('gutscheinGesperrt'),
  gutscheinPdfMerken: (...a) => (stoerung.pdfMerken ? kaputt('pdf merken') : echtRepo.gutscheinPdfMerken(...a)),
});

test('Dienste schreiben ganz oder gar nicht', { concurrency: 1, timeout: 60_000 }, async t => {
  const db = await zugangOderSkip(t, _req);
  if (!db) return;
  const NAME = `atomar-${process.pid}`;
  await db.run('DELETE FROM users WHERE username LIKE $1', [`${NAME}%`]);
  const neu = async (n, admin = false) =>
    (
      await db.get(`INSERT INTO users (username, password_hash, is_admin) VALUES ($1, 'x', $2) RETURNING id`, [
        n,
        admin,
      ])
    ).id;
  const chef = await neu(`${NAME}-chef`, true);
  const nutzer = await neu(`${NAME}-nutzer`);
  const K = _req('src/konto/index.js');
  const G = _req('src/gutscheine/index.js');
  const ordner = path.join(G.VOUCHER_DIR, String(nutzer));
  t.after(async () => {
    fs.rmSync(ordner, { recursive: true, force: true });
    await db.run('DELETE FROM users WHERE username LIKE $1', [`${NAME}%`]);
    await db.pool.end().catch(() => {});
  });
  const stoere = async (was, arbeit) => {
    stoerung[was] = true;
    try {
      await assert.rejects(arbeit, /Störung/);
    } finally {
      stoerung[was] = false;
    }
  };

  await t.test('scheitert der Protokolleintrag, gibt es kein Konto', async () => {
    await stoere('protokoll', () => K.legeKontoAn(chef, `${NAME}-neu`, 'Ein-Langes-Passwort-2026', false));
    assert.equal(await db.get('SELECT id FROM users WHERE username = $1', [`${NAME}-neu`]), undefined);
    // Ohne Störung entstehen Konto und Eintrag zusammen.
    const id = await K.legeKontoAn(chef, `${NAME}-neu`, 'Ein-Langes-Passwort-2026', false);
    const eintrag = await db.get('SELECT aktion FROM verwaltungsprotokoll WHERE ziel_id = $1', [id]);
    assert.equal(eintrag?.aktion, 'konto_angelegt');
  });

  await t.test('scheitert der Protokolleintrag beim Sperren, bleibt das Konto aktiv', async () => {
    await stoere('protokoll', () => K.aktivSetzen(chef, nutzer, false));
    assert.equal((await db.get('SELECT is_active FROM users WHERE id = $1', [nutzer])).is_active, true);
  });

  const pdf = Buffer.from('%PDF-1.4\n% Test\n');
  const zeilen = async () => (await db.all('SELECT id FROM vouchers WHERE user_id = $1', [nutzer])).length;
  const dateien = () => (fs.existsSync(ordner) ? fs.readdirSync(ordner).filter(n => n.endsWith('.pdf')) : []);

  await t.test('scheitert das Merken des Pfads, bleibt keine Gutscheinzeile und keine verwaiste Datei', async () => {
    const w = { number: '6000111122223333', pin: '123', amount: 25, currency: 'EUR' };
    await stoere('pdfMerken', () => G.gutscheinMitPdfAnlegen(nutzer, w, pdf));
    assert.equal(await zeilen(), 0);
    assert.deepEqual(dateien(), []);
    await stoere('pdfSchreiben', () => G.gutscheinMitPdfAnlegen(nutzer, w, pdf));
    assert.equal(await zeilen(), 0);
    // Ohne Störung: Zeile und Datei, und die Zeile kennt die Datei.
    const z = await G.gutscheinMitPdfAnlegen(nutzer, w, pdf);
    assert.equal(z.pdf_path, `${nutzer}/${z.id}.pdf`);
    assert.deepEqual(dateien(), [`${z.id}.pdf`]);
    assert.deepEqual(await G.gutscheinPdf(nutzer, z.id), pdf);
  });

  await t.test('zwei gleichzeitige Änderungen verlieren keine', async () => {
    const z = await G.gutscheinErfassen(nutzer, { number: '6000444455556666', pin: '111', amount: 10 });
    let zweiterDa;
    schranke = { n: 0, zweiter: new Promise(r => (zweiterDa = r)) };
    schranke.zweiterDa = zweiterDa;
    try {
      await Promise.all([
        G.gutscheinBearbeiten(nutzer, z.id, { amount: 42 }),
        G.gutscheinBearbeiten(nutzer, z.id, { pin: '999', number: G.maskiert(z).number }),
      ]);
    } finally {
      schranke = null;
    }
    const jetzt = await G.gutscheinKlartext(nutzer, z.id);
    assert.equal(Number(jetzt.amount), 42, 'der Betrag der ersten Änderung ging verloren');
    assert.equal(jetzt.pin, '999');
    assert.equal(jetzt.number, '6000444455556666');
  });
});
