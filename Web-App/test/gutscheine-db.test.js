/**
 * Gutscheine (LEGO-Geschenkkarten) — gegen eine echte Datenbank.
 *
 * ── Marcos Vorgabe ──────────────────────────────────────────────────────────
 *
 * „Im Eigenen Profil sollen Lego-Gutscheine mit Gutscheinnummer und Pins und
 * Betrag hinterlegt werden können. Für die Erfassung soll dies entweder
 * manuell möglich sein für die 3 Werte oder das PDF des Gutscheins soll
 * hochgeladen werden können und die App soll daraus die Werte extrahieren.
 * […] Die Erfassung, Änderung und Anzeige soll sowohl in der Android-App als
 * auch in der Webapp möglich sein […] Bitte die Login jeweils nur 1x im
 * Backend bauen. Beide Apps sollen die gleichen Services des Backends
 * verwenden."
 *
 * ── Warum mit DB und ueber HTTP ─────────────────────────────────────────────
 *
 * Die wichtigste Aussage dieser Funktion ist eine ABGRENZUNG, und die steht
 * nirgends im Quelltext zu lesen: Ein Gutschein gehoert NUR seinem Konto.
 * Ueberall sonst im Baum gilt das Haushalts-Blickfeld — der Grossvater sieht
 * die Sets der Enkel. Hier nicht, denn Nummer und PIN sind alles, was zum
 * Einloesen noetig ist.
 *
 * Eine Textpruefung koennte das nicht zeigen. Deshalb laufen hier echte
 * Anfragen gegen einen echten Router mit echter Datenbank, einmal mit
 * Sitzungscookie (Webapp) und einmal mit Bearer-Token (Android) — denn die
 * Aussage „beide Apps benutzen DENSELBEN Dienst" ist auch nur dann belegt,
 * wenn beide Wege an derselben Route ankommen.
 *
 * Voraussetzung: Test-DB (Inhalt wird geleert!) via TEST_DATABASE_URL.
 * Ausfuehren: REQUIRE_DB=1 npm test
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');

const ROOT = path.join(__dirname, '..');
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';
process.env.SESSION_SECRET = 'test-secret-lang-genug-fuer-die-pruefung';
process.env.WEB_WORKERS = '1';

const _req = require('./helpers/sources').buildAndRequire();
const db = _req('db/database.js');
const express = require(path.join(ROOT, 'node_modules', 'express'));
const session = require(path.join(ROOT, 'node_modules', 'express-session'));
const pgSession = require(path.join(ROOT, 'node_modules', 'connect-pg-simple'))(session);
const PDFDocument = require('pdfkit');   // kein Verzeichnispfad: pdfkit 0.20 hat nur `exports`

/**
 * Wo die Gutschein-PDFs liegen.
 *
 * Einmal aus festen Teilen zusammengesetzt, danach wird nur noch der
 * variable Rest drangehaengt. Der Grund steht in test/eigenbruecken.test.js:
 * Ein `path.join(ROOT, …)` mit variablem Segment nimmt jener Pruefung die
 * Sicht, ob ein Test eine Datei liest, die es gar nicht gibt. Hier ist der
 * feste Teil tatsaechlich fest — also gehoert er ausgeschrieben.
 */
const VOUCHER_DIR = path.join(ROOT, 'data', 'vouchers');

const U = {};

/** Ein Gutschein-PDF mit erfundenen Werten — nie ein echtes, das Repo ist oeffentlich. */
function pdfMit(zeilen) {
  return new Promise((fertig) => {
    const doc = new PDFDocument({ compress: true });
    const st = [];
    doc.on('data', s => st.push(s));
    doc.on('end', () => fertig(Buffer.concat(st)));
    doc.fontSize(12);
    for (const z of zeilen) doc.text(z);
    doc.end();
  });
}

async function seed() {
  await db.run('DROP SCHEMA public CASCADE');
  await db.run('CREATE SCHEMA public');
  await db.initSchema();
  const client = await db.pool.connect();
  try { await _req('db/migrate.js').runMigrations(client); } finally { client.release(); }
  for (const name of ['opa', 'enkel', 'chef']) {
    await db.run('INSERT INTO users (username, password_hash) VALUES ($1,$2)',
      [name, 'x']);
    U[name] = (await db.get('SELECT id FROM users WHERE username=$1', [name])).id;
  }
  // chef ist Administrator, opa ist Haupt-, enkel Unterkonto. Beides zusammen
  // stellt genau die zwei Durchgriffe her, die es hier NICHT geben darf.
  await db.run("UPDATE users SET is_admin = 1 WHERE id = $1", [U.chef]);
  await db.run('INSERT INTO account_links (main_user_id, sub_user_id) VALUES ($1,$2) ON CONFLICT DO NOTHING',
    [U.opa, U.enkel]);
}

async function dbErreichbar() {
  try { await db.get('SELECT 1 AS ok'); return true; } catch { return false; }
}

test('Gutscheine gegen echte Datenbank', { concurrency: 1 }, async (t) => {
  if (!(await dbErreichbar())) {
    await db.pool.end().catch(() => {});
    if (process.env.REQUIRE_DB === '1') throw new Error('REQUIRE_DB=1, aber die Test-Datenbank ist nicht erreichbar.');
    t.skip('Test-DB nicht erreichbar'); return;
  }
  await seed();

  // Ein Server wie der echte: derselbe Router, dieselbe Middleware.
  const app = express();
  app.use(express.json());
  app.use(session({
    store: new pgSession({ pool: db.pool, tableName: 'user_sessions', createTableIfMissing: false }),
    secret: process.env.SESSION_SECRET, resave: false, saveUninitialized: false,
  }));
  // Anmelden ohne Passwortweg: Der Test prueft Gutscheine, nicht die Anmeldung.
  app.get('/einloggen/:id/:admin', (req, res) => {
    req.session.userId = Number(req.params.id);
    req.session.isAdmin = req.params.admin === '1';
    res.json({ ok: true });
  });
  app.use('/api/v1', _req('routes/api_v1/index.js'));
  const srv = app.listen(0);
  const basis = `http://127.0.0.1:${srv.address().port}`;

  const alsNutzer = async (id, admin = false) => {
    const r = await fetch(`${basis}/einloggen/${id}/${admin ? 1 : 0}`);
    return (r.headers.get('set-cookie') || '').split(';')[0];
  };
  const hole = (pfad, keks, opts = {}) =>
    fetch(basis + pfad, { ...opts, headers: { cookie: keks, ...(opts.headers || {}) } });
  const jsonAn = (pfad, keks, methode, koerper) =>
    hole(pfad, keks, { method: methode, headers: { 'content-type': 'application/json' }, body: JSON.stringify(koerper) });

  const keksOpa   = await alsNutzer(U.opa);
  const keksEnkel = await alsNutzer(U.enkel);
  const keksChef  = await alsNutzer(U.chef, true);

  let opasGutschein;

  try {
    await t.test('manuell anlegen: die drei Werte landen in der Datenbank', async () => {
      const r = await jsonAn('/api/v1/vouchers', keksOpa, 'POST',
        { number: '5045076374450011166', pin: '5225', amount: 400, currency: 'CHF' });
      const b = await r.json();
      assert.equal(r.status, 200, JSON.stringify(b));
      assert.equal(b.voucher.number, '5045076374450011166');
      assert.equal(b.voucher.pin, '5225');
      assert.equal(b.voucher.amount, 400, 'der Betrag kommt als ZAHL zurueck, nicht als Zeichenkette');
      assert.equal(b.voucher.currency, 'CHF');
      assert.equal(b.voucher.hat_pdf, false);
      opasGutschein = b.voucher.id;

      // Und wirklich exakt — NUMERIC, nicht Gleitkomma.
      const zeile = await db.get('SELECT amount::text AS a FROM vouchers WHERE id=$1', [opasGutschein]);
      assert.equal(zeile.a, '400.00', 'der Betrag steht exakt in der Datenbank');
    });

    await t.test('dieselbe Karte ein zweites Mal gibt 409, nicht stillschweigend nichts', async () => {
      const r = await jsonAn('/api/v1/vouchers', keksOpa, 'POST',
        { number: '5045076374450011166', pin: '5225', amount: 400 });
      assert.equal(r.status, 409);
    });

    await t.test('unbrauchbare Eingaben werden abgewiesen', async () => {
      const faelle = [
        [{ number: 'abc', amount: 10 },                    'nummer_ungueltig'],
        [{ number: '1234567890123', amount: 0 },           'betrag_ungueltig'],
        [{ number: '1234567890124', amount: -5 },          'betrag_ungueltig'],
        [{ number: '1234567890125' },                      'betrag_ungueltig'],
        [{ number: '1234567890126', amount: 10, pin: 'ab' }, 'pin_ungueltig'],
        [{ number: '1234567890127', amount: 10, currency: 'Franken' }, 'waehrung_ungueltig'],
      ];
      for (const [koerper, code] of faelle) {
        const r = await jsonAn('/api/v1/vouchers', keksOpa, 'POST', koerper);
        assert.equal(r.status, 400, `${JSON.stringify(koerper)} haette abgewiesen werden muessen`);
        assert.equal((await r.json()).code, code, `falscher Grund fuer ${JSON.stringify(koerper)}`);
      }
    });

    await t.test('ein fehlender Betrag legt KEINEN Gutschein ueber null an', async () => {
      // Die Umkehrung zur Regel oben. Number(undefined) ist NaN, Number('') ist
      // 0 — ohne die untere Grenze haette ein leeres Formularfeld einen
      // Gutschein ueber nichts angelegt, und zwar ohne jede Fehlermeldung.
      const vorher = (await db.get('SELECT COUNT(*)::int AS n FROM vouchers')).n;
      await jsonAn('/api/v1/vouchers', keksOpa, 'POST', { number: '9999999999999', amount: '' });
      const nachher = (await db.get('SELECT COUNT(*)::int AS n FROM vouchers')).n;
      assert.equal(nachher, vorher, 'es darf keine Zeile dazugekommen sein');
    });

    // ── Die Abgrenzung: NUR der Eigentuemer ─────────────────────────────────
    await t.test('der Haushalt sieht den Gutschein NICHT', async () => {
      // opa ist Hauptkonto von enkel. Bei Sets, Teilen und der Merkliste saehe
      // opa alles von enkel — hier ist es umgekehrt UND gesperrt: Weder sieht
      // enkel opas Gutschein, noch opa einen von enkel.
      const r = await hole('/api/v1/vouchers', keksEnkel);
      const b = await r.json();
      assert.deepEqual(b.vouchers, [], 'die Liste eines anderen Kontos muss leer sein');
    });

    await t.test('ein fremdes Konto kann den Gutschein nicht lesen, aendern oder loeschen', async () => {
      for (const [methode, pfad, keks, wer] of [
        ['GET',    `/api/v1/vouchers/${opasGutschein}/pdf`, keksEnkel, 'Haushalt'],
        ['PUT',    `/api/v1/vouchers/${opasGutschein}`,     keksEnkel, 'Haushalt'],
        ['DELETE', `/api/v1/vouchers/${opasGutschein}`,     keksEnkel, 'Haushalt'],
        ['GET',    `/api/v1/vouchers/${opasGutschein}/pdf`, keksChef,  'Administrator'],
        ['PUT',    `/api/v1/vouchers/${opasGutschein}`,     keksChef,  'Administrator'],
        ['DELETE', `/api/v1/vouchers/${opasGutschein}`,     keksChef,  'Administrator'],
      ]) {
        const r = methode === 'GET'
          ? await hole(pfad, keks)
          : await jsonAn(pfad, keks, methode, { amount: 1 });
        assert.equal(r.status, 404, `${wer} durfte ${methode} ${pfad} nicht`);
      }
      // Und die Zeile steht noch.
      const n = (await db.get('SELECT COUNT(*)::int AS n FROM vouchers WHERE id=$1', [opasGutschein])).n;
      assert.equal(n, 1, 'der Gutschein muss die Versuche ueberlebt haben');
    });

    await t.test('ohne Anmeldung geht gar nichts', async () => {
      const r = await fetch(`${basis}/api/v1/vouchers`);
      assert.equal(r.status, 401);
    });

    // ── Der PDF-Weg ─────────────────────────────────────────────────────────
    await t.test('aus dem PDF: Werte werden gelesen und der Gutschein angelegt', async () => {
      const pdf = await pdfMit([
        'Ihre LEGO-Geschenkkarte im Wert von 250 CHF:',
        '5045076374450019999',
        'PIN: 4711',
      ]);
      const form = new FormData();
      form.append('file', new Blob([pdf], { type: 'application/pdf' }), 'gutschein.pdf');
      const r = await hole('/api/v1/vouchers/pdf', keksOpa, { method: 'POST', body: form });
      const b = await r.json();
      assert.equal(r.status, 200, JSON.stringify(b));
      assert.equal(b.voucher.number, '5045076374450019999');
      assert.equal(b.voucher.pin, '4711');
      assert.equal(b.voucher.amount, 250);
      assert.equal(b.voucher.hat_pdf, true, 'der Gutschein muss sein PDF behalten');
      assert.equal(b.gelesen.number, '5045076374450019999', 'was gelesen wurde, kommt mit zurueck');

      // Die Datei liegt unter data/vouchers/<uid>/ und NICHT unter uploads/.
      const zeile = await db.get('SELECT pdf_path FROM vouchers WHERE id=$1', [b.voucher.id]);
      assert.equal(zeile.pdf_path, `${U.opa}/${b.voucher.id}.pdf`);
      const datei = path.join(VOUCHER_DIR, zeile.pdf_path);
      assert.ok(fs.existsSync(datei), `die PDF-Datei fehlt: ${datei}`);
    });

    await t.test('das PDF kommt wieder heraus — zum Anzeigen und zum Herunterladen', async () => {
      const liste = await (await hole('/api/v1/vouchers', keksOpa)).json();
      const mitPdf = liste.vouchers.find(v => v.hat_pdf);
      assert.ok(mitPdf, 'Vorbedingung: ein Gutschein mit PDF');

      const anzeigen = await hole(`/api/v1/vouchers/${mitPdf.id}/pdf`, keksOpa);
      assert.equal(anzeigen.status, 200);
      assert.match(anzeigen.headers.get('content-type') || '', /application\/pdf/);
      assert.match(anzeigen.headers.get('content-disposition') || '', /^inline/,
        'ohne ?download=1 soll das PDF im Fenster erscheinen, nicht im Download-Ordner');
      const bytes = Buffer.from(await anzeigen.arrayBuffer());
      assert.equal(bytes.subarray(0, 5).toString(), '%PDF-', 'es muss wirklich ein PDF zurueckkommen');

      const laden = await hole(`/api/v1/vouchers/${mitPdf.id}/pdf?download=1`, keksOpa);
      assert.match(laden.headers.get('content-disposition') || '', /^attachment/);
      assert.match(laden.headers.get('content-disposition') || '', /gutschein-5045076374450019999\.pdf/,
        'der Dateiname traegt die Kartennummer — sonst heissen alle gleich');
    });

    await t.test('ein PDF ohne lesbare Werte gibt 422 und legt nichts an', async () => {
      const vorher = (await db.get('SELECT COUNT(*)::int AS n FROM vouchers')).n;
      const pdf = await pdfMit(['Rechnung Nr. 12', 'Vielen Dank.']);
      const form = new FormData();
      form.append('file', new Blob([pdf], { type: 'application/pdf' }), 'rechnung.pdf');
      const r = await hole('/api/v1/vouchers/pdf', keksOpa, { method: 'POST', body: form });
      assert.equal(r.status, 422);
      const b = await r.json();
      assert.equal(b.gelesen.number, null, 'die Oberflaeche erfaehrt, dass nichts gelesen wurde');
      const nachher = (await db.get('SELECT COUNT(*)::int AS n FROM vouchers')).n;
      assert.equal(nachher, vorher, 'ein unlesbares PDF darf keine Zeile anlegen');
    });

    await t.test('fehlende Werte duerfen von Hand ergaenzt werden — dieselbe Route', async () => {
      // Marcos Vorgabe nennt beide Wege gleichrangig. Hier treffen sie sich:
      // Die Datei kommt mit, der Betrag von Hand, und beides zusammen ergibt
      // einen Gutschein. Ohne das muesste der Nutzer bei einem unleserlichen
      // PDF auf das Hochladen verzichten — und haette den Gutschein nie
      // wieder zur Hand.
      const pdf = await pdfMit(['Geschenkkarte', '5045076374450017777']);
      const form = new FormData();
      form.append('file', new Blob([pdf], { type: 'application/pdf' }), 'g.pdf');
      form.append('amount', '125');
      form.append('currency', 'EUR');
      form.append('pin', '9090');
      const r = await hole('/api/v1/vouchers/pdf', keksOpa, { method: 'POST', body: form });
      const b = await r.json();
      assert.equal(r.status, 200, JSON.stringify(b));
      assert.equal(b.voucher.number, '5045076374450017777', 'die Nummer kam aus dem PDF');
      assert.equal(b.voucher.amount, 125, 'der Betrag kam von Hand');
      assert.equal(b.voucher.currency, 'EUR');
    });

    await t.test('etwas, das kein PDF ist, wird abgewiesen', async () => {
      const form = new FormData();
      form.append('file', new Blob([Buffer.from('kein PDF')], { type: 'text/plain' }), 'x.txt');
      const r = await hole('/api/v1/vouchers/pdf', keksOpa, { method: 'POST', body: form });
      assert.notEqual(r.status, 200, 'eine Textdatei darf nicht als Gutschein durchgehen');
    });

    // ── Aendern ─────────────────────────────────────────────────────────────
    await t.test('aendern laesst stehen, was nicht mitkommt', async () => {
      const r = await jsonAn(`/api/v1/vouchers/${opasGutschein}`, keksOpa, 'PUT', { amount: 350 });
      const b = await r.json();
      assert.equal(r.status, 200, JSON.stringify(b));
      assert.equal(b.voucher.amount, 350, 'der neue Betrag');
      assert.equal(b.voucher.number, '5045076374450011166', 'die Nummer darf nicht verschwinden');
      assert.equal(b.voucher.pin, '5225', 'der PIN darf nicht verschwinden');
      assert.equal(b.voucher.pin, '5225', 'der PIN darf nicht verschwinden');
    });

    await t.test('eine Karte auf die Nummer einer anderen umschreiben gibt 409', async () => {
      const r = await jsonAn(`/api/v1/vouchers/${opasGutschein}`, keksOpa, 'PUT',
        { number: '5045076374450019999' });
      assert.equal(r.status, 409);
    });

    // ── Der Android-Weg: derselbe Dienst ────────────────────────────────────
    await t.test('mit Bearer-Token kommt die App an DIESELBE Route', async () => {
      // Marcos Vorgabe „beide Apps sollen die gleichen Services verwenden"
      // ist genau hier belegt: kein zweiter Router, kein zweiter Pfad — nur
      // ein anderer Ausweis an derselben Tuer.
      // Die Tabelle haelt den SHA-256-Hex des Tokens, nicht den Klartext —
      // der Klartext existiert nur beim Klienten (siehe utils/auth.ts). Ein
      // Test, der den Klartext einfuegt, prueft nichts.
      const alsHash = t => crypto.createHash('sha256').update(t).digest('hex');
      await db.run(
        `INSERT INTO api_tokens (user_id, token, expires_at) VALUES ($1,$2, NOW() + INTERVAL '1 day')`,
        [U.opa, alsHash('test-token-gutscheine')]);
      const r = await fetch(`${basis}/api/v1/vouchers`, {
        headers: { authorization: 'Bearer test-token-gutscheine' } });
      const b = await r.json();
      assert.equal(r.status, 200, JSON.stringify(b));
      assert.ok(b.vouchers.length >= 2, 'die App sieht dieselben Gutscheine wie die Webapp');

      // Und die Abgrenzung gilt auch hier: ein Token des Enkels sieht nichts.
      await db.run(
        `INSERT INTO api_tokens (user_id, token, expires_at) VALUES ($1,$2, NOW() + INTERVAL '1 day')`,
        [U.enkel, alsHash('test-token-enkel')]);
      const r2 = await fetch(`${basis}/api/v1/vouchers`, {
        headers: { authorization: 'Bearer test-token-enkel' } });
      assert.deepEqual((await r2.json()).vouchers, []);
    });

    // ── Loeschen ────────────────────────────────────────────────────────────
    await t.test('loeschen nimmt Zeile UND Datei mit', async () => {
      const liste = await (await hole('/api/v1/vouchers', keksOpa)).json();
      const mitPdf = liste.vouchers.find(v => v.hat_pdf);
      const zeile = await db.get('SELECT pdf_path FROM vouchers WHERE id=$1', [mitPdf.id]);
      const datei = path.join(VOUCHER_DIR, zeile.pdf_path);
      assert.ok(fs.existsSync(datei), 'Vorbedingung: die Datei liegt da');

      const r = await hole(`/api/v1/vouchers/${mitPdf.id}`, keksOpa, { method: 'DELETE' });
      assert.equal(r.status, 200);
      assert.equal((await db.get('SELECT COUNT(*)::int AS n FROM vouchers WHERE id=$1', [mitPdf.id])).n, 0);
      assert.ok(!fs.existsSync(datei), 'die Datei muss mit der Zeile verschwinden');
    });

    await t.test('die Notiz-Spalte gibt es nicht mehr', async () => {
      // Marcos Vorgabe: „Das Feld ‚Notiz' bitte vollständig inkl. Spalten auf
      // der Datenbank entfernen." Eine Spalte, die niemand mehr schreibt,
      // waere nicht „entfernt", sondern nur unbenutzt — und taucht im
      // Schema-Abgleich, im Sicherungs-Export und in jedem SELECT * wieder
      // auf. Geprueft wird deshalb das Schema selbst (Migration 0027).
      const spalte = await db.get(
        `SELECT column_name FROM information_schema.columns
          WHERE table_schema='public' AND table_name='vouchers' AND column_name='note'`);
      assert.equal(spalte, undefined, 'die Spalte `note` steht noch in der Tabelle');
    });

    await t.test('mit dem Konto verschwinden auch seine Gutscheine', async () => {
      // ON DELETE CASCADE. Ohne das blieben Nummer und PIN eines geloeschten
      // Kontos in der Datenbank stehen — Zahlen, die weiter einloesbar sind.
      await db.run('INSERT INTO vouchers (user_id, number, amount) VALUES ($1,$2,$3)',
        [U.enkel, '5045076374450013333', 60]);
      assert.equal((await db.get('SELECT COUNT(*)::int AS n FROM vouchers WHERE user_id=$1', [U.enkel])).n, 1);
      await db.run('DELETE FROM users WHERE id = $1', [U.enkel]);
      assert.equal((await db.get('SELECT COUNT(*)::int AS n FROM vouchers WHERE user_id=$1', [U.enkel])).n, 0);
    });

  } finally {
    await new Promise(r => srv.close(r));
    await fs.promises.rm(VOUCHER_DIR, { recursive: true, force: true }).catch(() => {});
    await db.pool.end().catch(() => {});
  }
});

/**
 * Die Oberflaeche der Webapp — Marcos Nachbesserungen vom 06.10.
 *
 * Textpruefungen, und das ist hier angemessen: Was geprueft wird, sind
 * Entscheidungen ueber die DARSTELLUNG, und die stehen nirgendwo sonst. Was
 * der Server tut, pruefen die Zusicherungen darueber gegen eine echte
 * Datenbank.
 */
const testOberflaeche = require('node:test');
testOberflaeche('Gutscheine in der Webapp: Marcos Nachbesserungen', async (t) => {
  const fsO = require('node:fs');
  // Die Pfade unten stehen AUSGESCHRIEBEN und nicht hinter einem Helfer mit
  // Variable: Ein `path.join(ROOT, rel)` nimmt test/eigenbruecken.test.js die
  // Sicht darauf, ob ein Test eine Datei liest, die es gar nicht gibt — und
  // genau dieser Waechter ist hier prompt rot geworden.
  // ohneKommentare: Die Erklaertexte in 17-gutscheine.js nennen die
  // entfernten Wege beim Namen („Hier standen zwei Knoepfe: window.open …").
  // Eine Textpruefung, die sie mitliest, prueft die Prosa und nicht den Code —
  // und war prompt rot, obwohl der Code stimmte.
  const { ohneKommentare } = require('./helpers/sources');
  const js = ohneKommentare(fsO.readFileSync(path.join(ROOT, 'public', 'js', '17-gutscheine.js'), 'utf8'));
  const html = fsO.readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8');
  const css = fsO.readFileSync(path.join(ROOT, 'public', 'styles.css'), 'utf8');

  await t.test('das PDF geht in den Betrachter der Anleitungen', () => {
    // „Die beiden Buttons PDF Download und PDF im neuen Fenster öffnen
    // entfernen und durch den PDF-Viewer der Anleitungen ersetzen → Analog
    // wie es in der Android-App umgesetzt ist."
    assert.match(js, /openPdfViewer\(/, 'der Betrachter wird nicht benutzt');
    assert.ok(!/window\.open\(/.test(js), 'es wird noch ein neues Fenster geoeffnet');
    assert.ok(!/download=1/.test(js),
      'der zweite Knopf ist noch da — der Betrachter traegt seinen Download selbst');
  });

  await t.test('Nummer und PIN haben je einen Kopieren-Knopf', () => {
    // „Kannst du in der Webapp hinter den Gutscheincode und den Pin jeweils
    // einen Kopieren Button einfügen (mit einem Icon)."
    const treffer = js.match(/data-click="gutscheinKopieren"/g) || [];
    assert.equal(treffer.length, 2, `erwartet 2 Kopieren-Knoepfe, gefunden ${treffer.length}`);
    assert.match(js, /KOPIE_ICON_SVG/, 'der Knopf traegt kein Symbol');
    // Kopiert wird die ROHE Nummer: Die Vierergruppen sind eine Lesehilfe,
    // ein Bezahlfeld nimmt sie nicht an.
    //
    // Geprueft wird die Zeile IN der Kopierfunktion, nicht irgendein
    // `String(g.number)` in der Datei. Die erste Fassung tat Letzteres und
    // blieb bei der Gegenprobe gruen — die Anzeigefunktion darueber enthaelt
    // denselben Ausdruck, also bestand sie aus dem falschen Grund.
    const kopierRumpf = js.slice(js.indexOf('function gutscheinKopieren'));
    assert.match(kopierRumpf.slice(0, 400), /String\(g\.number\)/,
      'in gutscheinKopieren wird nicht die rohe Nummer genommen');
    assert.ok(!/\.replace\(\/\(\.\{4\}\)\//.test(kopierRumpf.slice(0, 400)),
      'die Kopierfunktion gruppiert die Nummer — ein Bezahlfeld nimmt das nicht an');
  });

  await t.test('die Notiz ist auch aus der Oberflaeche verschwunden', () => {
    for (const [name, inhalt] of [['17-gutscheine.js', js], ['index.html', html], ['styles.css', css]]) {
      assert.ok(!/v-note|vouchers\.note|voucher-note/.test(inhalt),
        `${name} nennt die Notiz noch`);
    }
  });

  await t.test('das Dateifeld bekommt Platz fuer seinen eingebauten Knopf', () => {
    // Marcos Befund: „der rot markierte Bereich beim Upload ist zu klein. Der
    // Text wird abgeschnitten." Ursache war `.fg input{height:38px}` auf einem
    // nativen Dateifeld.
    assert.match(html, /class="fg voucher-upload"/, 'das Dateifeld traegt die eigene Klasse nicht');
    assert.match(css, /\.voucher-upload input\[type=file\]\{[^}]*height:auto/,
      'die Hoehe steht nicht auf auto — eine feste Zahl schneidet je nach Browser wieder ab');
  });
});
