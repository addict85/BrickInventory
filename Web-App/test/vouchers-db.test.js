/**
 * Gutscheine (LEGO-Geschenkkarten) — gegen eine echte Datenbank.
 *
 * Gegenprobe (11.11.2026 gemessen): in GET /vouchers/:id/pdf den Kopf
 *   Content-Security-Policy gestrichen → rot: „das PDF kommt wieder heraus …“
 */
require('./helpers/system-frame');
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');

const ROOT = path.join(__dirname, '..');
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';
process.env.SESSION_SECRET = 'test-secret-lang-genug-fuer-die-pruefung';

const { buildAndRequire, testData } = require('./helpers/sources');
const _req = buildAndRequire();
const { keineDb } = require('./helpers/db');
const db = testData();
const express = require(path.join(ROOT, 'node_modules', 'express'));
const session = require(path.join(ROOT, 'node_modules', 'express-session'));
const pgSession = require(path.join(ROOT, 'node_modules', 'connect-pg-simple'))(session);
const PDFDocument = require('pdfkit'); // kein Verzeichnispfad: pdfkit 0.20 hat nur `exports`

/**
 * Wo die Gutschein-PDFs liegen.
 */
const VOUCHER_DIR = path.join(ROOT, 'data', 'vouchers');

const U = {};
const PASS = 'Gutschein-Passwort-1';

/** Ein Gutschein-PDF mit erfundenen Werten — nie ein echtes, das Repo ist oeffentlich. */
function pdfWith(zeilen) {
  return new Promise(fertig => {
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
  try {
    await _req('db/migrate.js').runMigrations(client);
  } finally {
    client.release();
  }
  for (const name of ['grandparent', 'enkel', 'chef']) {
    await db.run('INSERT INTO users (username, password_hash) VALUES ($1,$2)', [
      name,
      require(path.join(ROOT, 'node_modules', 'bcryptjs')).hashSync(PASS, 4),
    ]);
    U[name] = (await db.get('SELECT id FROM users WHERE username=$1', [name])).id;
  }
  // chef ist Administrator, opa ist Haupt-, enkel Unterkonto. Beides zusammen
  // stellt genau die zwei Durchgriffe her, die es hier NICHT geben darf.
  await db.run('UPDATE users SET is_admin = true WHERE id = $1', [U.chef]);
  await db.run('INSERT INTO account_links (main_user_id, sub_user_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [
    U.grandparent,
    U.enkel,
  ]);
}

async function dbReachable() {
  try {
    await db.get('SELECT 1 AS ok');
    return true;
  } catch {
    return false;
  }
}

test('vouchers against a real database', { concurrency: 1 }, async t => {
  if (!(await dbReachable())) {
    await db.pool.end().catch(() => {});
    keineDb(t);
    return;
  }
  await seed();

  // Ein Server wie der echte: derselbe Router, dieselbe Middleware.
  const app = express();
  app.use(express.json());
  app.use(
    session({
      store: new pgSession({ pool: db.pool, tableName: 'user_sessions', createTableIfMissing: false }),
      secret: process.env.SESSION_SECRET,
      resave: false,
      saveUninitialized: false,
    }),
  );
  // Anmelden ohne Passwortweg: Der Test prueft Gutscheine, nicht die Anmeldung.
  app.get('/einloggen/:id/:admin', (req, res) => {
    req.session.userId = Number(req.params.id);
    req.session.isAdmin = req.params.admin === '1';
    res.json({ ok: true });
  });
  app.use('/api/v1', require('./helpers/sources').routerFrom(_req, 'routes/api_v1/index.js'));
  const srv = app.listen(0);
  const basis = `http://127.0.0.1:${srv.address().port}`;

  const asUser = async (id, admin = false) => {
    const r = await fetch(`${basis}/einloggen/${id}/${admin ? 1 : 0}`);
    // Erst den Rumpf ganz lesen: express-session hält das letzte Byte zurück,
    // bis die Sitzung gespeichert ist; fetch() kehrt schon mit den Kopfzeilen zurück.
    const rumpf = await r.text();
    const keks = (r.headers.get('set-cookie') || '').split(';')[0];
    // Trägt die Sitzung nicht, wären alle folgenden Fälle nur 401 — dann hier die Ursache nennen.
    const probe = await fetch(`${basis}/api/v1/vouchers`, { headers: { cookie: keks } });
    if (!r.ok || !keks || probe.status !== 200)
      assert.fail(
        `Anmeldung als ${id} trägt nicht: ${r.status} ${rumpf}, Keks ${keks ? 'da' : 'fehlt'}, ` +
          `Probe ${probe.status} ${await probe.text()}`,
      );
    return keks;
  };
  const hole = (pfad, keks, opts = {}) =>
    fetch(basis + pfad, { ...opts, headers: { cookie: keks, ...(opts.headers || {}) } });
  const jsonAn = (pfad, keks, methode, koerper) =>
    hole(pfad, keks, {
      method: methode,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(koerper),
    });

  const cookieGrandparent = await asUser(U.grandparent);
  const cookieGrandchild = await asUser(U.enkel);
  const keksChef = await asUser(U.chef, true);

  let grandparentsVoucher;

  try {
    await t.test('create manually: the three values land in the database', async () => {
      const r = await jsonAn('/api/v1/vouchers', cookieGrandparent, 'POST', {
        number: '5045076374450011166',
        pin: '5225',
        amount: 400,
        currency: 'CHF',
      });
      const b = await r.json();
      assert.equal(r.status, 200, JSON.stringify(b));
      assert.equal(b.voucher.number, '…1166');
      assert.equal(b.voucher.pin, '•••');
      assert.equal(b.voucher.amount, 400, 'der Betrag kommt als ZAHL zurueck, nicht als Zeichenkette');
      assert.equal(b.voucher.currency, 'CHF');
      assert.equal(b.voucher.hat_pdf, false);
      grandparentsVoucher = b.voucher.id;

      // Und wirklich exakt — NUMERIC, nicht Gleitkomma.
      const zeile = await db.get('SELECT amount::text AS a FROM vouchers WHERE id=$1', [grandparentsVoucher]);
      assert.equal(Number(zeile.a), 400, 'der Betrag steht exakt in der Datenbank');
    });

    await t.test('the same card a second time gives 409, not silently nothing', async () => {
      const r = await jsonAn('/api/v1/vouchers', cookieGrandparent, 'POST', {
        number: '5045076374450011166',
        pin: '5225',
        amount: 400,
      });
      assert.equal(r.status, 409);
    });

    await t.test('unusable input is rejected', async () => {
      const faelle = [
        [{ number: 'abc', amount: 10 }, 'nummer_ungueltig'],
        [{ number: '1234567890123', amount: 0 }, 'betrag_ungueltig'],
        [{ number: '1234567890124', amount: -5 }, 'betrag_ungueltig'],
        [{ number: '1234567890125' }, 'betrag_ungueltig'],
        [{ number: '1234567890126', amount: 10, pin: 'ab' }, 'pin_ungueltig'],
        [{ number: '1234567890127', amount: 10, currency: 'Franken' }, 'waehrung_ungueltig'],
      ];
      for (const [koerper, code] of faelle) {
        const r = await jsonAn('/api/v1/vouchers', cookieGrandparent, 'POST', koerper);
        assert.equal(r.status, 400, `${JSON.stringify(koerper)} haette abgewiesen werden muessen`);
        assert.equal((await r.json()).code, code, `falscher Grund fuer ${JSON.stringify(koerper)}`);
      }
    });

    await t.test('a missing amount does NOT create a voucher over zero', async () => {
      // Die Umkehrung zur Regel oben. Number(undefined) ist NaN, Number('') ist
      // 0 — ohne die untere Grenze haette ein leeres Formularfeld einen
      // Gutschein ueber nichts angelegt, und zwar ohne jede Fehlermeldung.
      const vorher = (await db.get('SELECT COUNT(*)::int AS n FROM vouchers')).n;
      await jsonAn('/api/v1/vouchers', cookieGrandparent, 'POST', { number: '9999999999999', amount: '' });
      const nachher = (await db.get('SELECT COUNT(*)::int AS n FROM vouchers')).n;
      assert.equal(nachher, vorher, 'es darf keine Zeile dazugekommen sein');
    });

    // ── Die Abgrenzung: NUR der Eigentuemer ─────────────────────────────────
    await t.test('the household does NOT see the voucher', async () => {
      // opa ist Hauptkonto von enkel. Bei Sets, Teilen und der Merkliste saehe
      // opa alles von enkel — hier ist es umgekehrt UND gesperrt: Weder sieht
      // enkel opas Gutschein, noch opa einen von enkel.
      const r = await hole('/api/v1/vouchers', cookieGrandchild);
      const b = await r.json();
      assert.deepEqual(b.vouchers, [], 'die Liste eines anderen Kontos muss leer sein');
    });

    await t.test('a foreign account cannot read, change or delete the voucher', async () => {
      for (const [methode, pfad, keks, wer] of [
        ['POST', `/api/v1/vouchers/${grandparentsVoucher}/pdf-freigabe`, cookieGrandchild, 'Haushalt'],
        ['PUT', `/api/v1/vouchers/${grandparentsVoucher}`, cookieGrandchild, 'Haushalt'],
        ['DELETE', `/api/v1/vouchers/${grandparentsVoucher}`, cookieGrandchild, 'Haushalt'],
        ['POST', `/api/v1/vouchers/${grandparentsVoucher}/pdf-freigabe`, keksChef, 'Administrator'],
        ['PUT', `/api/v1/vouchers/${grandparentsVoucher}`, keksChef, 'Administrator'],
        ['DELETE', `/api/v1/vouchers/${grandparentsVoucher}`, keksChef, 'Administrator'],
      ]) {
        const r =
          methode === 'GET'
            ? await hole(pfad, keks)
            : await jsonAn(pfad, keks, methode, methode === 'PUT' ? { amount: 1 } : { password: PASS });
        assert.equal(r.status, 404, `${wer} durfte ${methode} ${pfad} nicht`);
      }
      // Und die Zeile steht noch.
      const n = (await db.get('SELECT COUNT(*)::int AS n FROM vouchers WHERE id=$1', [grandparentsVoucher])).n;
      assert.equal(n, 1, 'der Gutschein muss die Versuche ueberlebt haben');
    });

    await t.test('without login nothing works at all', async () => {
      const r = await fetch(`${basis}/api/v1/vouchers`);
      assert.equal(r.status, 401);
    });

    // ── Der PDF-Weg ─────────────────────────────────────────────────────────
    await t.test('from the PDF: values are read and the voucher is created', async () => {
      const pdf = await pdfWith(['Ihre LEGO-Geschenkkarte im Wert von 250 CHF:', '5045076374450019999', 'PIN: 4711']);
      const form = new FormData();
      form.append('file', new Blob([pdf], { type: 'application/pdf' }), 'gutschein.pdf');
      const r = await hole('/api/v1/vouchers/pdf', cookieGrandparent, { method: 'POST', body: form });
      const b = await r.json();
      assert.equal(r.status, 200, JSON.stringify(b));
      assert.equal(b.voucher.number, '…9999');
      assert.equal(b.voucher.pin, '•••');
      assert.equal(b.voucher.amount, 250);
      assert.equal(b.voucher.hat_pdf, true, 'der Gutschein muss sein PDF behalten');
      assert.equal(b.gelesen.number, '5045076374450019999', 'was gelesen wurde, kommt mit zurueck');

      // Die Datei liegt unter data/vouchers/<uid>/ und NICHT unter uploads/.
      const zeile = await db.get('SELECT pdf_path FROM vouchers WHERE id=$1', [b.voucher.id]);
      assert.equal(zeile.pdf_path, `${U.grandparent}/${b.voucher.id}.pdf`);
      const datei = path.join(VOUCHER_DIR, zeile.pdf_path);
      assert.ok(fs.existsSync(datei), `die PDF-Datei fehlt: ${datei}`);
    });

    await t.test('the PDF comes out again — for viewing and downloading', async () => {
      const liste = await (await hole('/api/v1/vouchers', cookieGrandparent)).json();
      const withPdf = liste.vouchers.find(v => v.hat_pdf);
      assert.ok(withPdf, 'Vorbedingung: ein Gutschein mit PDF');

      const ticket = async () =>
        (
          await (
            await jsonAn(`/api/v1/vouchers/${withPdf.id}/pdf-freigabe`, cookieGrandparent, 'POST', { password: PASS })
          ).json()
        ).ticket;
      const anzeigen = await hole(`/api/v1/vouchers/${withPdf.id}/pdf?ticket=${await ticket()}`, cookieGrandparent);
      assert.equal(anzeigen.status, 200);
      assert.match(anzeigen.headers.get('content-type') || '', /application\/pdf/);
      assert.match(
        anzeigen.headers.get('content-disposition') || '',
        /^inline/,
        'ohne ?download=1 soll das PDF im Fenster erscheinen, nicht im Download-Ordner',
      );
      assert.equal(
        anzeigen.headers.get('content-security-policy'),
        "sandbox; default-src 'none'",
        'ein hochgeladenes PDF läuft auch inline nicht unter der Herkunft der App',
      );
      const bytes = Buffer.from(await anzeigen.arrayBuffer());
      assert.equal(bytes.subarray(0, 5).toString(), '%PDF-', 'es muss wirklich ein PDF zurueckkommen');

      const laden = await hole(
        `/api/v1/vouchers/${withPdf.id}/pdf?download=1&ticket=${await ticket()}`,
        cookieGrandparent,
      );
      assert.match(laden.headers.get('content-disposition') || '', /^attachment/);
      assert.equal(
        laden.headers.get('content-disposition'),
        `attachment; filename="gutschein-${withPdf.id}.pdf"`,
        'der Dateiname trägt die id, nicht die Kartennummer',
      );
    });

    // Gegenproben (03.11.2026 gemessen, je einzeln): in GET /vouchers/:id/pdf die
    // Ticketprüfung entfernt → rot „ohne Ticket kein PDF“; in redeemTicket() das
    // Löschen weggelassen → rot „ein Ticket gilt einmal“; den Vergleich des Ziels
    // gestrichen → rot „… nur für sein PDF“; confirmWithFactor() in der Freigabe
    // entfernt → rot „Freigabe nur mit Passwort“; protokolliere() entfernt → rot
    // „die Freigabe steht im Protokoll“; Frist auf -1 s → rot „… 60 Sekunden“.
    await t.test('the PDF only with a one-time ticket from a confirmed approval', async () => {
      const liste = await (await hole('/api/v1/vouchers', cookieGrandparent)).json();
      const withPdf = liste.vouchers.find(v => v.hat_pdf);
      const pdf = ticket =>
        hole(`/api/v1/vouchers/${withPdf.id}/pdf${ticket ? `?ticket=${ticket}` : ''}`, cookieGrandparent);
      const withoutTicket = await pdf();
      assert.deepEqual(
        [withoutTicket.status, (await withoutTicket.json()).code],
        [403, 'pdf_freigabe_noetig'],
        'ohne Ticket kein PDF',
      );
      const withoutPw = await jsonAn(`/api/v1/vouchers/${withPdf.id}/pdf-freigabe`, cookieGrandparent, 'POST', {});
      assert.deepEqual(
        [withoutPw.status, (await withoutPw.json()).code],
        [400, 'aktuelles_passwort_falsch'],
        'Freigabe nur mit Passwort',
      );
      await db.run("DELETE FROM admin_log WHERE action IN ('gutschein_pdf', 'gutschein_export')");
      const f = await (
        await jsonAn(`/api/v1/vouchers/${withPdf.id}/pdf-freigabe`, cookieGrandparent, 'POST', { password: PASS })
      ).json();
      assert.deepEqual([f.success, typeof f.ticket, f.gueltig_sek], [true, 'string', 60]);
      assert.ok(f.ticket.length >= 32);
      assert.equal(
        (await hole(`/api/v1/vouchers/${grandparentsVoucher}/pdf?ticket=${f.ticket}`, cookieGrandparent)).status,
        403,
        'ein Ticket gilt nur für sein PDF',
      );
      const f2 = await (
        await jsonAn(`/api/v1/vouchers/${withPdf.id}/pdf-freigabe`, cookieGrandparent, 'POST', { password: PASS })
      ).json();
      assert.equal(
        (await hole(`/api/v1/vouchers/${withPdf.id}/pdf?ticket=${f2.ticket}`, cookieGrandchild)).status,
        403,
        'ein Ticket gilt nur für sein Konto',
      );
      const f3 = await (
        await jsonAn(`/api/v1/vouchers/${withPdf.id}/pdf-freigabe`, cookieGrandparent, 'POST', { password: PASS })
      ).json();
      const erst = await pdf(f3.ticket);
      assert.equal(erst.status, 200);
      await erst.arrayBuffer();
      assert.equal((await pdf(f3.ticket)).status, 403, 'ein Ticket gilt einmal');
      const alt = await (
        await jsonAn(`/api/v1/vouchers/${withPdf.id}/pdf-freigabe`, cookieGrandparent, 'POST', { password: PASS })
      ).json();
      const realTime = Date.now;
      Date.now = () => realTime() + 61_000;
      try {
        assert.equal((await pdf(alt.ticket)).status, 403, 'ein Ticket gilt 60 Sekunden');
      } finally {
        Date.now = realTime;
      }
      const ex = await jsonAn('/api/v1/vouchers/export/pdf-freigabe', cookieGrandparent, 'POST', { password: PASS });
      const exTicket = (await ex.json()).ticket;
      assert.equal(
        (await hole('/api/v1/vouchers/export/pdf', cookieGrandparent)).status,
        403,
        'der Export ohne Ticket',
      );
      assert.equal(
        (await hole(`/api/v1/vouchers/${withPdf.id}/pdf?ticket=${exTicket}`, cookieGrandparent)).status,
        403,
        'das Export-Ticket öffnet kein einzelnes PDF',
      );
      assert.deepEqual(
        (
          await db.all(
            "SELECT action, target_id FROM admin_log WHERE action IN ('gutschein_pdf', 'gutschein_export') ORDER BY id",
          )
        ).map(z => z.action),
        ['gutschein_pdf', 'gutschein_pdf', 'gutschein_pdf', 'gutschein_pdf', 'gutschein_export'],
        'die Freigabe steht im Protokoll',
      );
    });

    await t.test('a PDF without readable values gives 422 and creates nothing', async () => {
      const vorher = (await db.get('SELECT COUNT(*)::int AS n FROM vouchers')).n;
      const pdf = await pdfWith(['Rechnung Nr. 12', 'Vielen Dank.']);
      const form = new FormData();
      form.append('file', new Blob([pdf], { type: 'application/pdf' }), 'rechnung.pdf');
      const r = await hole('/api/v1/vouchers/pdf', cookieGrandparent, { method: 'POST', body: form });
      assert.equal(r.status, 422);
      const b = await r.json();
      assert.equal(b.gelesen.number, null, 'die Oberflaeche erfaehrt, dass nichts gelesen wurde');
      const nachher = (await db.get('SELECT COUNT(*)::int AS n FROM vouchers')).n;
      assert.equal(nachher, vorher, 'ein unlesbares PDF darf keine Zeile anlegen');
    });

    await t.test('missing values may be completed by hand — the same route', async () => {
      // Marcos Vorgabe nennt beide Wege gleichrangig. Hier treffen sie sich:
      // Die Datei kommt mit, der Betrag von Hand, und beides zusammen ergibt
      // einen Gutschein. Ohne das muesste der Nutzer bei einem unleserlichen
      // PDF auf das Hochladen verzichten — und haette den Gutschein nie
      // wieder zur Hand.
      const pdf = await pdfWith(['Geschenkkarte', '5045076374450017777']);
      const form = new FormData();
      form.append('file', new Blob([pdf], { type: 'application/pdf' }), 'g.pdf');
      form.append('amount', '125');
      form.append('currency', 'EUR');
      form.append('pin', '9090');
      const r = await hole('/api/v1/vouchers/pdf', cookieGrandparent, { method: 'POST', body: form });
      const b = await r.json();
      assert.equal(r.status, 200, JSON.stringify(b));
      assert.equal(b.gelesen.number, '5045076374450017777', 'die Nummer kam aus dem PDF');
      assert.equal(b.voucher.amount, 125, 'der Betrag kam von Hand');
      assert.equal(b.voucher.currency, 'EUR');
    });

    await t.test('something that is not a PDF is rejected', async () => {
      const form = new FormData();
      form.append('file', new Blob([Buffer.from('kein PDF')], { type: 'text/plain' }), 'x.txt');
      const r = await hole('/api/v1/vouchers/pdf', cookieGrandparent, { method: 'POST', body: form });
      // Ganz lesen: Bis die Sitzung gespeichert ist, hält der Server das Ende der
      // Antwort und damit den Upload-Platz des Kontos; der nächste Fall bekäme 429.
      await r.arrayBuffer();
      assert.notEqual(r.status, 200, 'eine Textdatei darf nicht als Gutschein durchgehen');
    });

    // Gegenprobe (am 28.10.2026 gemessen): die Absage bei `!istPdf` in
    // routes/api_v1/vouchers.ts entfernt → rot (200, Datei abgelegt).
    await t.test('reported as PDF but not one: rejected even with typed-in values', async () => {
      const form = new FormData();
      form.append(
        'file',
        new Blob([Buffer.from('<html><script>1</script></html>')], { type: 'application/pdf' }),
        'x.pdf',
      );
      form.append('number', '5045076374450018888');
      form.append('pin', '1212');
      form.append('amount', '20');
      const r = await hole('/api/v1/vouchers/pdf', cookieGrandparent, { method: 'POST', body: form });
      assert.equal(r.status, 422);
      assert.equal((await r.json()).code, 'pdf_unlesbar');
      const nummer_suche = _req('src/vouchers/repository/vouchers.js').numberSearch(
        U.grandparent,
        '5045076374450018888',
      );
      assert.equal(
        (await db.get('SELECT count(*)::int AS n FROM vouchers WHERE number_search = $1', [nummer_suche])).n,
        0,
      );
    });

    // ── Aendern ─────────────────────────────────────────────────────────────
    await t.test('changing leaves alone what does not come along', async () => {
      const r = await jsonAn(`/api/v1/vouchers/${grandparentsVoucher}`, cookieGrandparent, 'PUT', { amount: 350 });
      const b = await r.json();
      assert.equal(r.status, 200, JSON.stringify(b));
      assert.equal(b.voucher.amount, 350, 'der neue Betrag');
      const k = await (
        await jsonAn(`/api/v1/vouchers/${grandparentsVoucher}/klartext`, cookieGrandparent, 'POST', { password: PASS })
      ).json();
      assert.deepEqual([k.number, k.pin], ['5045076374450011166', '5225'], 'Nummer und PIN dürfen nicht verschwinden');
    });

    // Gegenprobe (03.11.2026 gemessen): in PUT die Maske nicht erkannt → rot
    // „die Maske aus dem Formular ändert nichts“ (400 nummer_ungueltig).
    await t.test('the mask from the form changes nothing', async () => {
      const r = await jsonAn(`/api/v1/vouchers/${grandparentsVoucher}`, cookieGrandparent, 'PUT', {
        number: '…1166',
        pin: '•••',
        amount: 360,
      });
      assert.equal(r.status, 200, await r.text());
      const k = await (
        await jsonAn(`/api/v1/vouchers/${grandparentsVoucher}/klartext`, cookieGrandparent, 'POST', { password: PASS })
      ).json();
      assert.deepEqual([k.number, k.pin], ['5045076374450011166', '5225']);
    });

    // Gegenproben (03.11.2026 gemessen, je einzeln): forOuter() wieder mit
    // z.number/z.pin → rot „die Liste zeigt nur das Ende“; confirmWithFactor()
    // in /klartext entfernt → rot „Klartext nur mit Passwort“; protokolliere()
    // entfernt → rot „… steht im Protokoll“.
    await t.test('the list shows only the end, plain text only with password, and it is in the log', async () => {
      const liste = (await (await hole('/api/v1/vouchers', cookieGrandparent)).json()).vouchers;
      const withPin = liste.find(v => v.id === grandparentsVoucher);
      assert.deepEqual([withPin.number, withPin.pin], ['…1166', '•••'], 'die Liste zeigt nur das Ende');
      assert.ok(
        !JSON.stringify(liste).includes('5045076374450011166') && !JSON.stringify(liste).includes('5225'),
        'Nummer oder PIN im Klartext in der Liste',
      );
      const ohne = await jsonAn(`/api/v1/vouchers/${grandparentsVoucher}/klartext`, cookieGrandparent, 'POST', {});
      assert.deepEqual(
        [ohne.status, (await ohne.json()).code],
        [400, 'aktuelles_passwort_falsch'],
        'Klartext nur mit Passwort',
      );
      const fremd = await jsonAn(`/api/v1/vouchers/${grandparentsVoucher}/klartext`, cookieGrandchild, 'POST', {
        password: PASS,
      });
      assert.equal(fremd.status, 404, 'ein fremdes Konto liest den Klartext');
      await db.run("DELETE FROM admin_log WHERE action = 'gutschein_klartext'");
      const k = await jsonAn(`/api/v1/vouchers/${grandparentsVoucher}/klartext`, cookieGrandparent, 'POST', {
        password: PASS,
      });
      assert.deepEqual(await k.json(), {
        success: true,
        id: grandparentsVoucher,
        number: '5045076374450011166',
        pin: '5225',
      });
      assert.deepEqual(
        await db.all("SELECT admin_id, target_id, details FROM admin_log WHERE action = 'gutschein_klartext'"),
        [{ admin_id: U.grandparent, target_id: U.grandparent, details: '…1166' }],
        'der Abruf steht im Protokoll',
      );
    });

    await t.test('rewriting a card to the number of another gives 409', async () => {
      const r = await jsonAn(`/api/v1/vouchers/${grandparentsVoucher}`, cookieGrandparent, 'PUT', {
        number: '5045076374450019999',
      });
      assert.equal(r.status, 409);
    });

    // ── Der Android-Weg: derselbe Dienst ────────────────────────────────────
    await t.test('with a bearer token the app reaches the SAME route', async () => {
      // Marcos Vorgabe „beide Apps sollen die gleichen Services verwenden"
      // ist genau hier belegt: kein zweiter Router, kein zweiter Pfad — nur
      // ein anderer Ausweis an derselben Tuer.
      // Die Tabelle haelt den SHA-256-Hex des Tokens, nicht den Klartext — …
      const alsHash = t => crypto.createHash('sha256').update(t).digest('hex');
      await db.run(`INSERT INTO api_tokens (user_id, token, expires_at) VALUES ($1,$2, NOW() + INTERVAL '1 day')`, [
        U.grandparent,
        alsHash('test-token-gutscheine'),
      ]);
      const r = await fetch(`${basis}/api/v1/vouchers`, {
        headers: { authorization: 'Bearer test-token-gutscheine' },
      });
      const b = await r.json();
      assert.equal(r.status, 200, JSON.stringify(b));
      assert.ok(b.vouchers.length >= 2, 'die App sieht dieselben Gutscheine wie die Webapp');

      // Und die Abgrenzung gilt auch hier: ein Token des Enkels sieht nichts.
      await db.run(`INSERT INTO api_tokens (user_id, token, expires_at) VALUES ($1,$2, NOW() + INTERVAL '1 day')`, [
        U.enkel,
        alsHash('test-token-enkel'),
      ]);
      const r2 = await fetch(`${basis}/api/v1/vouchers`, {
        headers: { authorization: 'Bearer test-token-enkel' },
      });
      assert.deepEqual((await r2.json()).vouchers, []);
    });

    // ── Loeschen ────────────────────────────────────────────────────────────
    // Gegenprobe (03.11.2026 gemessen): confirmWithFactor() in DELETE
    // /vouchers/:id entfernt → rot „löschen ohne Passwort" (200 statt 400).
    await t.test('deleting takes row AND file along', async () => {
      const liste = await (await hole('/api/v1/vouchers', cookieGrandparent)).json();
      const withPdf = liste.vouchers.find(v => v.hat_pdf);
      const zeile = await db.get('SELECT pdf_path FROM vouchers WHERE id=$1', [withPdf.id]);
      const datei = path.join(VOUCHER_DIR, zeile.pdf_path);
      assert.ok(fs.existsSync(datei), 'Vorbedingung: die Datei liegt da');

      const ohne = await hole(`/api/v1/vouchers/${withPdf.id}`, cookieGrandparent, { method: 'DELETE' });
      assert.deepEqual(
        [ohne.status, (await ohne.json()).code],
        [400, 'aktuelles_passwort_falsch'],
        'löschen ohne Passwort',
      );
      assert.ok(fs.existsSync(datei), 'ohne Passwort ist die Datei weg');
      const r = await jsonAn(`/api/v1/vouchers/${withPdf.id}`, cookieGrandparent, 'DELETE', { password: PASS });
      assert.equal(r.status, 200);
      assert.equal((await db.get('SELECT COUNT(*)::int AS n FROM vouchers WHERE id=$1', [withPdf.id])).n, 0);
      assert.ok(!fs.existsSync(datei), 'die Datei muss mit der Zeile verschwinden');
    });

    await t.test('the note column no longer exists', async () => {
      // Marcos Vorgabe: „Das Feld ‚Notiz' bitte vollständig inkl. Spalten auf
      // der Datenbank entfernen." Eine Spalte, die niemand mehr schreibt,
      // waere nicht „entfernt", sondern nur unbenutzt — und taucht im
      // Schema-Abgleich, im Sicherungs-Export und in jedem SELECT * wieder
      // auf. Geprueft wird deshalb das Schema selbst (Migration 0027).
      const spalte = await db.get(
        `SELECT column_name FROM information_schema.columns
          WHERE table_schema='public' AND table_name='vouchers' AND column_name='note'`,
      );
      assert.equal(spalte, undefined, 'die Spalte `note` steht noch in der Tabelle');
    });

    await t.test('with the account its vouchers disappear too', async () => {
      // ON DELETE CASCADE. Ohne das blieben Nummer und PIN eines geloeschten
      // Kontos in der Datenbank stehen — Zahlen, die weiter einloesbar sind.
      await require('./helpers/sources')
        .testArea('vouchers')
        .vouchers.createVoucher(U.enkel, { number: '5045076374450013333', pin: null, amount: 60, currency: null });
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
const testUi = require('node:test');
testUi('Gutscheine in der Webapp: Marcos Nachbesserungen', async t => {
  const fsO = require('node:fs');
  // Die Pfade unten stehen AUSGESCHRIEBEN und nicht hinter einem Helfer mit
  // Variable: Ein `path.join(ROOT, rel)` nimmt test/eigenbruecken.test.js die
  // Sicht darauf, ob ein Test eine Datei liest, die es gar nicht gibt — und
  // genau dieser Waechter ist hier prompt rot geworden. …
  const { ohneKommentare } = require('./helpers/sources');
  const js = ohneKommentare(fsO.readFileSync(path.join(ROOT, 'public', 'js', 'vouchers.js'), 'utf8'));
  const html = fsO.readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8');
  const css = fsO.readFileSync(path.join(ROOT, 'public', 'styles.css'), 'utf8');

  await t.test('the PDF goes into the instructions viewer', () => {
    // „Die beiden Buttons PDF Download und PDF im neuen Fenster öffnen
    // entfernen und durch den PDF-Viewer der Anleitungen ersetzen → Analog
    // wie es in der Android-App umgesetzt ist."
    assert.match(js, /openPdfViewer\(/, 'der Betrachter wird nicht benutzt');
    assert.ok(!/window\.open\(/.test(js), 'es wird noch ein neues Fenster geoeffnet');
    assert.ok(!/download=1/.test(js), 'der zweite Knopf ist noch da — der Betrachter traegt seinen Download selbst');
  });

  await t.test('number and PIN each have a copy button', () => {
    // „Kannst du in der Webapp hinter den Gutscheincode und den Pin jeweils
    // einen Kopieren Button einfügen (mit einem Icon)."
    const treffer = js.match(/data-click="gutscheinKopieren"/g) || [];
    assert.equal(treffer.length, 2, `erwartet 2 Kopieren-Knoepfe, gefunden ${treffer.length}`);
    assert.match(js, /COPY_ICON_SVG/, 'der Knopf traegt kein Symbol');
    // Kopiert wird die ROHE Nummer: Die Vierergruppen sind eine Lesehilfe,
    // ein Bezahlfeld nimmt sie nicht an.
    const kopierBody = js.slice(js.indexOf('function gutscheinKopieren'));
    assert.match(
      kopierBody.slice(0, 400),
      /String\(k\.number\)/,
      'in gutscheinKopieren wird nicht die rohe Nummer genommen',
    );
    assert.ok(
      !/\.replace\(\/\(\.\{4\}\)\//.test(kopierBody.slice(0, 400)),
      'die Kopierfunktion gruppiert die Nummer — ein Bezahlfeld nimmt das nicht an',
    );
  });

  await t.test('the note has also disappeared from the UI', () => {
    for (const [name, inhalt] of [
      ['vouchers.js', js],
      ['index.html', html],
      ['styles.css', css],
    ]) {
      assert.ok(!/v-note|vouchers\.note|voucher-note/.test(inhalt), `${name} nennt die Notiz noch`);
    }
  });

  await t.test('the file field is a styled button as with the instructions', () => {
    // Das native Feld schnitt seinen Text ab und sah anders aus als jede
    // andere Dateiwahl; jetzt dieselbe Form (label.btn mit .datei-versteckt).
    assert.match(
      html,
      /<label class="btn bs zeiger">[\s\S]*?<input type="file" id="v-pdf"[^>]*class="datei-versteckt"/,
      'die Dateiwahl der Gutscheine ist kein Knopf mit verstecktem Feld',
    );
    assert.ok(!/\.voucher-upload input\[type=file\]/.test(css), 'die Regel fuer das native Feld steht noch da');
  });
});
