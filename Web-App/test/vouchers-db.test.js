/**
 * Vouchers (LEGO gift cards) — against a real database.
 *
 * Counter-check (measured 11.11.2026): in GET /vouchers/:id/pdf the header
 *   Content-Security-Policy deleted → red: “the PDF comes out again …”
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
const { noDb } = require('./helpers/db');
const db = testData();
const express = require(path.join(ROOT, 'node_modules', 'express'));
const session = require(path.join(ROOT, 'node_modules', 'express-session'));
const pgSession = require(path.join(ROOT, 'node_modules', 'connect-pg-simple'))(session);
const PDFDocument = require('pdfkit'); // no directory path: pdfkit 0.20 only has `exports`

/**
 * Where the voucher PDFs lie.
 */
const VOUCHER_DIR = path.join(ROOT, 'data', 'vouchers');

const U = {};
const PASS = 'Gutschein-Passwort-1';

/** A voucher PDF with invented values — never a real one, the repo is public. */
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
  // chef is an administrator, opa is a main account, enkel a sub-account. Both together
  // establish exactly the two reach-throughs that must NOT exist here.
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
    noDb(t);
    return;
  }
  await seed();

  // A server like the real one: the same router, the same middleware.
  const app = express();
  app.use(express.json());
  app.use(
    session({
      store: _req('src/account/sessionStore.js').hashSessionIds(
        new pgSession({ pool: db.pool, tableName: 'user_sessions', createTableIfMissing: false }),
      ),
      secret: process.env.SESSION_SECRET,
      resave: false,
      saveUninitialized: false,
    }),
  );
  // Log in without the password path: the test checks vouchers, not the login.
  app.get('/einloggen/:id/:admin', (req, res) => {
    req.session.userId = Number(req.params.id);
    req.session.isAdmin = req.params.admin === '1';
    res.json({ ok: true });
  });
  app.use(_req('src/http/apiV1Alias.js').apiV1Alias);
  app.use('/api/v2', require('./helpers/sources').routerFrom(_req, 'routes/api/index.js'));
  const srv = app.listen(0);
  const basis = `http://127.0.0.1:${srv.address().port}`;

  const asUser = async (id, admin = false) => {
    const r = await fetch(`${basis}/einloggen/${id}/${admin ? 1 : 0}`);
    // Read the body completely first: express-session holds back the last byte
    // until the session is stored; fetch() already returns with the headers.
    const rumpf = await r.text();
    const keks = (r.headers.get('set-cookie') || '').split(';')[0];
    // If the session does not carry, all following cases would only be 401 — then name the cause here.
    const probe = await fetch(`${basis}/api/v2/vouchers`, { headers: { cookie: keks } });
    if (!r.ok || !keks || probe.status !== 200)
      assert.fail(
        `Anmeldung als ${id} trägt nicht: ${r.status} ${rumpf}, Keks ${keks ? 'da' : 'missing'}, ` +
          `Probe ${probe.status} ${await probe.text()}`,
      );
    return keks;
  };
  const hole = (path, keks, opts = {}) =>
    fetch(basis + path, { ...opts, headers: { cookie: keks, ...(opts.headers || {}) } });
  const jsonTo = (path, keks, methode, koerper) =>
    hole(path, keks, {
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
      const r = await jsonTo('/api/v2/vouchers', cookieGrandparent, 'POST', {
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
      assert.equal(b.voucher.has_pdf, false);
      grandparentsVoucher = b.voucher.id;

      // And really exact — NUMERIC, not floating point.
      const row = await db.get('SELECT amount::text AS a FROM vouchers WHERE id=$1', [grandparentsVoucher]);
      assert.equal(Number(row.a), 400, 'der Betrag steht exakt in der Datenbank');
    });

    await t.test('the same card a second time gives 409, not silently nothing', async () => {
      const r = await jsonTo('/api/v2/vouchers', cookieGrandparent, 'POST', {
        number: '5045076374450011166',
        pin: '5225',
        amount: 400,
      });
      assert.equal(r.status, 409);
    });

    await t.test('unusable input is rejected', async () => {
      const faelle = [
        [{ number: 'abc', amount: 10 }, 'number_invalid'],
        [{ number: '1234567890123', amount: 0 }, 'amount_invalid'],
        [{ number: '1234567890124', amount: -5 }, 'amount_invalid'],
        [{ number: '1234567890125' }, 'amount_invalid'],
        [{ number: '1234567890126', amount: 10, pin: 'ab' }, 'pin_invalid'],
        [{ number: '1234567890127', amount: 10, currency: 'Franken' }, 'currency_invalid'],
      ];
      for (const [koerper, code] of faelle) {
        const r = await jsonTo('/api/v2/vouchers', cookieGrandparent, 'POST', koerper);
        assert.equal(r.status, 400, `${JSON.stringify(koerper)} haette abgewiesen werden muessen`);
        assert.equal((await r.json()).code, code, `falscher Grund fuer ${JSON.stringify(koerper)}`);
      }
    });

    await t.test('a missing amount does NOT create a voucher over zero', async () => {
      // The reverse of the rule above. Number(undefined) is NaN, Number('') is
      // 0 — without the lower bound an empty form field would have created a
      // voucher over nothing, and without any error message.
      const vorher = (await db.get('SELECT COUNT(*)::int AS n FROM vouchers')).n;
      await jsonTo('/api/v2/vouchers', cookieGrandparent, 'POST', { number: '9999999999999', amount: '' });
      const nachher = (await db.get('SELECT COUNT(*)::int AS n FROM vouchers')).n;
      assert.equal(nachher, vorher, 'es darf keine Zeile dazugekommen sein');
    });

    // ── The demarcation: ONLY the owner ─────────────────────────────────
    await t.test('the household does NOT see the voucher', async () => {
      // opa is the main account of enkel. For sets, parts and the wishlist opa
      // would see everything of enkel — here it is the other way round AND locked: neither does
      // enkel see opa's voucher, nor opa one of enkel's.
      const r = await hole('/api/v2/vouchers', cookieGrandchild);
      const b = await r.json();
      assert.deepEqual(b.vouchers, [], 'die Liste eines anderen Kontos muss leer sein');
    });

    await t.test('a foreign account cannot read, change or delete the voucher', async () => {
      for (const [methode, path, keks, wer] of [
        ['POST', `/api/v2/vouchers/${grandparentsVoucher}/pdf-grant`, cookieGrandchild, 'Haushalt'],
        ['PUT', `/api/v2/vouchers/${grandparentsVoucher}`, cookieGrandchild, 'Haushalt'],
        ['DELETE', `/api/v2/vouchers/${grandparentsVoucher}`, cookieGrandchild, 'Haushalt'],
        ['POST', `/api/v2/vouchers/${grandparentsVoucher}/pdf-grant`, keksChef, 'Administrator'],
        ['PUT', `/api/v2/vouchers/${grandparentsVoucher}`, keksChef, 'Administrator'],
        ['DELETE', `/api/v2/vouchers/${grandparentsVoucher}`, keksChef, 'Administrator'],
      ]) {
        const r =
          methode === 'GET'
            ? await hole(path, keks)
            : await jsonTo(path, keks, methode, methode === 'PUT' ? { amount: 1 } : { password: PASS });
        assert.equal(r.status, 404, `${wer} durfte ${methode} ${path} nicht`);
      }
      // And the row still stands.
      const n = (await db.get('SELECT COUNT(*)::int AS n FROM vouchers WHERE id=$1', [grandparentsVoucher])).n;
      assert.equal(n, 1, 'der Gutschein muss die Versuche ueberlebt haben');
    });

    await t.test('without login nothing works at all', async () => {
      const r = await fetch(`${basis}/api/v2/vouchers`);
      assert.equal(r.status, 401);
    });

    // ── The PDF path ─────────────────────────────────────────────────────────
    await t.test('from the PDF: values are read and the voucher is created', async () => {
      const pdf = await pdfWith(['Ihre LEGO-Geschenkkarte im Wert von 250 CHF:', '5045076374450019999', 'PIN: 4711']);
      const form = new FormData();
      form.append('file', new Blob([pdf], { type: 'application/pdf' }), 'gutschein.pdf');
      const r = await hole('/api/v2/vouchers/pdf', cookieGrandparent, { method: 'POST', body: form });
      const b = await r.json();
      assert.equal(r.status, 200, JSON.stringify(b));
      assert.equal(b.voucher.number, '…9999');
      assert.equal(b.voucher.pin, '•••');
      assert.equal(b.voucher.amount, 250);
      assert.equal(b.voucher.has_pdf, true, 'der Gutschein muss sein PDF behalten');
      assert.equal(b.parsed.number, '5045076374450019999', 'was gelesen wurde, kommt mit zurueck');

      // The file lies under data/vouchers/<uid>/ and NOT under uploads/.
      const row = await db.get('SELECT pdf_path FROM vouchers WHERE id=$1', [b.voucher.id]);
      assert.equal(row.pdf_path, `${U.grandparent}/${b.voucher.id}.pdf`);
      const datei = path.join(VOUCHER_DIR, row.pdf_path);
      assert.ok(fs.existsSync(datei), `die PDF-Datei fehlt: ${datei}`);
    });

    await t.test('the PDF comes out again — for viewing and downloading', async () => {
      const liste = await (await hole('/api/v2/vouchers', cookieGrandparent)).json();
      const withPdf = liste.vouchers.find(v => v.has_pdf);
      assert.ok(withPdf, 'Vorbedingung: ein Gutschein mit PDF');

      const ticket = async () =>
        (
          await (
            await jsonTo(`/api/v2/vouchers/${withPdf.id}/pdf-grant`, cookieGrandparent, 'POST', { password: PASS })
          ).json()
        ).ticket;
      const show = await hole(`/api/v2/vouchers/${withPdf.id}/pdf?ticket=${await ticket()}`, cookieGrandparent);
      assert.equal(show.status, 200);
      assert.match(show.headers.get('content-type') || '', /application\/pdf/);
      assert.match(
        show.headers.get('content-disposition') || '',
        /^inline/,
        'ohne ?download=1 soll das PDF im Fenster erscheinen, nicht im Download-Ordner',
      );
      assert.equal(
        show.headers.get('content-security-policy'),
        "sandbox; default-src 'none'",
        'ein hochgeladenes PDF läuft auch inline nicht unter der Herkunft der App',
      );
      const bytes = Buffer.from(await show.arrayBuffer());
      assert.equal(bytes.subarray(0, 5).toString(), '%PDF-', 'es muss wirklich ein PDF zurueckkommen');

      const laden = await hole(
        `/api/v2/vouchers/${withPdf.id}/pdf?download=1&ticket=${await ticket()}`,
        cookieGrandparent,
      );
      assert.match(laden.headers.get('content-disposition') || '', /^attachment/);
      assert.equal(
        laden.headers.get('content-disposition'),
        `attachment; filename="gutschein-${withPdf.id}.pdf"`,
        'der Dateiname trägt die id, nicht die Kartennummer',
      );
    });

    // Counter-checks (measured 03.11.2026, each on its own): in GET /vouchers/:id/pdf the
    // ticket check removed → red „ohne Ticket kein PDF“; in redeemTicket() the
    // deletion left out → red „ein Ticket gilt einmal“; the comparison of the target
    // deleted → red „… nur für sein PDF“; confirmWithFactor() removed in the release
    // → red „Freigabe nur mit Passwort“; protokolliere() removed → red
    // „die Freigabe steht im Protokoll“; period set to -1 s → red „… 60 Sekunden“.
    await t.test('the PDF only with a one-time ticket from a confirmed approval', async () => {
      const liste = await (await hole('/api/v2/vouchers', cookieGrandparent)).json();
      const withPdf = liste.vouchers.find(v => v.has_pdf);
      const pdf = ticket =>
        hole(`/api/v2/vouchers/${withPdf.id}/pdf${ticket ? `?ticket=${ticket}` : ''}`, cookieGrandparent);
      const withoutTicket = await pdf();
      assert.deepEqual(
        [withoutTicket.status, (await withoutTicket.json()).code],
        [403, 'pdf_grant_required'],
        'ohne Ticket kein PDF',
      );
      const withoutPw = await jsonTo(`/api/v2/vouchers/${withPdf.id}/pdf-grant`, cookieGrandparent, 'POST', {});
      assert.deepEqual(
        [withoutPw.status, (await withoutPw.json()).code],
        [400, 'current_password_wrong'],
        'Freigabe nur mit Passwort',
      );
      await db.run("DELETE FROM admin_log WHERE action IN ('voucher_pdf', 'voucher_export')");
      const f = await (
        await jsonTo(`/api/v2/vouchers/${withPdf.id}/pdf-grant`, cookieGrandparent, 'POST', { password: PASS })
      ).json();
      assert.deepEqual([f.success, typeof f.ticket, f.valid_seconds], [true, 'string', 60]);
      assert.ok(f.ticket.length >= 32);
      assert.equal(
        (await hole(`/api/v2/vouchers/${grandparentsVoucher}/pdf?ticket=${f.ticket}`, cookieGrandparent)).status,
        403,
        'ein Ticket gilt nur für sein PDF',
      );
      const f2 = await (
        await jsonTo(`/api/v2/vouchers/${withPdf.id}/pdf-grant`, cookieGrandparent, 'POST', { password: PASS })
      ).json();
      assert.equal(
        (await hole(`/api/v2/vouchers/${withPdf.id}/pdf?ticket=${f2.ticket}`, cookieGrandchild)).status,
        403,
        'ein Ticket gilt nur für sein Konto',
      );
      const f3 = await (
        await jsonTo(`/api/v2/vouchers/${withPdf.id}/pdf-grant`, cookieGrandparent, 'POST', { password: PASS })
      ).json();
      const erst = await pdf(f3.ticket);
      assert.equal(erst.status, 200);
      await erst.arrayBuffer();
      assert.equal((await pdf(f3.ticket)).status, 403, 'ein Ticket gilt einmal');
      const alt = await (
        await jsonTo(`/api/v2/vouchers/${withPdf.id}/pdf-grant`, cookieGrandparent, 'POST', { password: PASS })
      ).json();
      const realTime = Date.now;
      Date.now = () => realTime() + 61_000;
      try {
        assert.equal((await pdf(alt.ticket)).status, 403, 'ein Ticket gilt 60 Sekunden');
      } finally {
        Date.now = realTime;
      }
      const ex = await jsonTo('/api/v2/vouchers/export/pdf-grant', cookieGrandparent, 'POST', { password: PASS });
      const exTicket = (await ex.json()).ticket;
      assert.equal(
        (await hole('/api/v2/vouchers/export/pdf', cookieGrandparent)).status,
        403,
        'der Export ohne Ticket',
      );
      assert.equal(
        (await hole(`/api/v2/vouchers/${withPdf.id}/pdf?ticket=${exTicket}`, cookieGrandparent)).status,
        403,
        'das Export-Ticket öffnet kein einzelnes PDF',
      );
      assert.deepEqual(
        (
          await db.all(
            "SELECT action, target_id FROM admin_log WHERE action IN ('voucher_pdf', 'voucher_export') ORDER BY id",
          )
        ).map(z => z.action),
        ['voucher_pdf', 'voucher_pdf', 'voucher_pdf', 'voucher_pdf', 'voucher_export'],
        'die Freigabe steht im Protokoll',
      );
    });

    await t.test('a PDF without readable values gives 422 and creates nothing', async () => {
      const vorher = (await db.get('SELECT COUNT(*)::int AS n FROM vouchers')).n;
      const pdf = await pdfWith(['Rechnung Nr. 12', 'Vielen Dank.']);
      const form = new FormData();
      form.append('file', new Blob([pdf], { type: 'application/pdf' }), 'rechnung.pdf');
      const r = await hole('/api/v2/vouchers/pdf', cookieGrandparent, { method: 'POST', body: form });
      assert.equal(r.status, 422);
      const b = await r.json();
      assert.equal(b.parsed.number, null, 'die Oberflaeche erfaehrt, dass nichts gelesen wurde');
      const nachher = (await db.get('SELECT COUNT(*)::int AS n FROM vouchers')).n;
      assert.equal(nachher, vorher, 'ein unlesbares PDF darf keine Zeile anlegen');
    });

    await t.test('missing values may be completed by hand — the same route', async () => {
      // Marco's specification names both paths as equal. Here they meet:
      // the file comes along, the amount by hand, and both together make
      // a voucher. Without that the user would, with an illegible
      // PDF have to do without the upload — and would never have the voucher
      // at hand again.
      const pdf = await pdfWith(['Geschenkkarte', '5045076374450017777']);
      const form = new FormData();
      form.append('file', new Blob([pdf], { type: 'application/pdf' }), 'g.pdf');
      form.append('amount', '125');
      form.append('currency', 'EUR');
      form.append('pin', '9090');
      const r = await hole('/api/v2/vouchers/pdf', cookieGrandparent, { method: 'POST', body: form });
      const b = await r.json();
      assert.equal(r.status, 200, JSON.stringify(b));
      assert.equal(b.parsed.number, '5045076374450017777', 'die Nummer kam aus dem PDF');
      assert.equal(b.voucher.amount, 125, 'der Betrag kam von Hand');
      assert.equal(b.voucher.currency, 'EUR');
    });

    await t.test('something that is not a PDF is rejected', async () => {
      const form = new FormData();
      form.append('file', new Blob([Buffer.from('kein PDF')], { type: 'text/plain' }), 'x.txt');
      const r = await hole('/api/v2/vouchers/pdf', cookieGrandparent, { method: 'POST', body: form });
      // Read completely: until the session is stored, the server holds the end of the
      // response and thus the account's upload slot; the next case would get 429.
      await r.arrayBuffer();
      assert.notEqual(r.status, 200, 'eine Textdatei darf nicht als Gutschein durchgehen');
    });

    // Counter-check (measured on 28.10.2026): the refusal at `!istPdf` removed in
    // routes/api/vouchers.ts → red (200, file stored).
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
      const r = await hole('/api/v2/vouchers/pdf', cookieGrandparent, { method: 'POST', body: form });
      assert.equal(r.status, 422);
      assert.equal((await r.json()).code, 'pdf_unreadable');
      const nummer_suche = _req('src/vouchers/repository/vouchers.js').numberSearch(
        U.grandparent,
        '5045076374450018888',
      );
      assert.equal(
        (await db.get('SELECT count(*)::int AS n FROM vouchers WHERE number_search = $1', [nummer_suche])).n,
        0,
      );
    });

    // ── Changing ─────────────────────────────────────────────────────────────
    await t.test('changing leaves alone what does not come along', async () => {
      const r = await jsonTo(`/api/v2/vouchers/${grandparentsVoucher}`, cookieGrandparent, 'PUT', { amount: 350 });
      const b = await r.json();
      assert.equal(r.status, 200, JSON.stringify(b));
      assert.equal(b.voucher.amount, 350, 'der neue Betrag');
      const k = await (
        await jsonTo(`/api/v2/vouchers/${grandparentsVoucher}/plaintext`, cookieGrandparent, 'POST', { password: PASS })
      ).json();
      assert.deepEqual([k.number, k.pin], ['5045076374450011166', '5225'], 'Nummer und PIN dürfen nicht verschwinden');
    });

    // Counter-check (measured 03.11.2026): the mask not recognized in PUT → red
    // “the mask from the form changes nothing” (400 number_invalid).
    await t.test('the mask from the form changes nothing', async () => {
      const r = await jsonTo(`/api/v2/vouchers/${grandparentsVoucher}`, cookieGrandparent, 'PUT', {
        number: '…1166',
        pin: '•••',
        amount: 360,
      });
      assert.equal(r.status, 200, await r.text());
      const k = await (
        await jsonTo(`/api/v2/vouchers/${grandparentsVoucher}/plaintext`, cookieGrandparent, 'POST', { password: PASS })
      ).json();
      assert.deepEqual([k.number, k.pin], ['5045076374450011166', '5225']);
    });

    // Counter-checks (measured 03.11.2026, each on its own): forOuter() again with
    // z.number/z.pin → red „die Liste zeigt nur das Ende“; confirmWithFactor()
    // removed in /klartext → red „Klartext nur mit Passwort“; protokolliere()
    // removed → red „… steht im Protokoll“.
    await t.test('the list shows only the end, plain text only with password, and it is in the log', async () => {
      const liste = (await (await hole('/api/v2/vouchers', cookieGrandparent)).json()).vouchers;
      const withPin = liste.find(v => v.id === grandparentsVoucher);
      assert.deepEqual([withPin.number, withPin.pin], ['…1166', '•••'], 'die Liste zeigt nur das Ende');
      assert.ok(
        !JSON.stringify(liste).includes('5045076374450011166') && !JSON.stringify(liste).includes('5225'),
        'Nummer oder PIN im Klartext in der Liste',
      );
      const ohne = await jsonTo(`/api/v2/vouchers/${grandparentsVoucher}/plaintext`, cookieGrandparent, 'POST', {});
      assert.deepEqual(
        [ohne.status, (await ohne.json()).code],
        [400, 'current_password_wrong'],
        'Klartext nur mit Passwort',
      );
      const fremd = await jsonTo(`/api/v2/vouchers/${grandparentsVoucher}/plaintext`, cookieGrandchild, 'POST', {
        password: PASS,
      });
      assert.equal(fremd.status, 404, 'ein fremdes Konto liest den Klartext');
      await db.run("DELETE FROM admin_log WHERE action = 'voucher_plaintext'");
      const k = await jsonTo(`/api/v2/vouchers/${grandparentsVoucher}/plaintext`, cookieGrandparent, 'POST', {
        password: PASS,
      });
      assert.deepEqual(await k.json(), {
        success: true,
        id: grandparentsVoucher,
        number: '5045076374450011166',
        pin: '5225',
      });
      assert.deepEqual(
        await db.all("SELECT admin_id, target_id, details FROM admin_log WHERE action = 'voucher_plaintext'"),
        [{ admin_id: U.grandparent, target_id: U.grandparent, details: '…1166' }],
        'der Abruf steht im Protokoll',
      );
    });

    await t.test('rewriting a card to the number of another gives 409', async () => {
      const r = await jsonTo(`/api/v2/vouchers/${grandparentsVoucher}`, cookieGrandparent, 'PUT', {
        number: '5045076374450019999',
      });
      assert.equal(r.status, 409);
    });

    // ── The Android path: the same service ────────────────────────────────────
    await t.test('with a bearer token the app reaches the SAME route', async () => {
      // Marco's specification „beide Apps sollen die gleichen Services verwenden"
      // is proven exactly here: no second router, no second path — only
      // a different credential at the same door.
      // The table holds the SHA-256 hex of the token, not the plain text — …
      const alsHash = t => crypto.createHash('sha256').update(t).digest('hex');
      await db.run(`INSERT INTO api_tokens (user_id, token, expires_at) VALUES ($1,$2, NOW() + INTERVAL '1 day')`, [
        U.grandparent,
        alsHash('test-token-gutscheine'),
      ]);
      const r = await fetch(`${basis}/api/v2/vouchers`, {
        headers: { authorization: 'Bearer test-token-gutscheine' },
      });
      const b = await r.json();
      assert.equal(r.status, 200, JSON.stringify(b));
      assert.ok(b.vouchers.length >= 2, 'die App sieht dieselben Gutscheine wie die Webapp');

      // And the demarcation applies here too: a token of the grandchild sees nothing.
      await db.run(`INSERT INTO api_tokens (user_id, token, expires_at) VALUES ($1,$2, NOW() + INTERVAL '1 day')`, [
        U.enkel,
        alsHash('test-token-enkel'),
      ]);
      const r2 = await fetch(`${basis}/api/v2/vouchers`, {
        headers: { authorization: 'Bearer test-token-enkel' },
      });
      assert.deepEqual((await r2.json()).vouchers, []);
    });

    // ── Deleting ────────────────────────────────────────────────────────────
    // Counter-check (measured 03.11.2026): confirmWithFactor() removed in DELETE
    // /vouchers/:id → red „löschen ohne Passwort" (200 instead of 400).
    await t.test('deleting takes row AND file along', async () => {
      const liste = await (await hole('/api/v2/vouchers', cookieGrandparent)).json();
      const withPdf = liste.vouchers.find(v => v.has_pdf);
      const row = await db.get('SELECT pdf_path FROM vouchers WHERE id=$1', [withPdf.id]);
      const datei = path.join(VOUCHER_DIR, row.pdf_path);
      assert.ok(fs.existsSync(datei), 'Vorbedingung: die Datei liegt da');

      const ohne = await hole(`/api/v2/vouchers/${withPdf.id}`, cookieGrandparent, { method: 'DELETE' });
      assert.deepEqual(
        [ohne.status, (await ohne.json()).code],
        [400, 'current_password_wrong'],
        'löschen ohne Passwort',
      );
      assert.ok(fs.existsSync(datei), 'ohne Passwort ist die Datei weg');
      const r = await jsonTo(`/api/v2/vouchers/${withPdf.id}`, cookieGrandparent, 'DELETE', { password: PASS });
      assert.equal(r.status, 200);
      assert.equal((await db.get('SELECT COUNT(*)::int AS n FROM vouchers WHERE id=$1', [withPdf.id])).n, 0);
      assert.ok(!fs.existsSync(datei), 'die Datei muss mit der Zeile verschwinden');
    });

    await t.test('the note column no longer exists', async () => {
      // Marco's specification: „Das Feld ‚Notiz' bitte vollständig inkl. Spalten auf
      // der Datenbank entfernen." A column that nobody writes any more
      // would not be „removed" but only unused — and shows up again in the
      // schema comparison, in the backup export and in every SELECT *.
      // Hence the schema itself is checked (migration 0027).
      const spalte = await db.get(
        `SELECT column_name FROM information_schema.columns
          WHERE table_schema='public' AND table_name='vouchers' AND column_name='note'`,
      );
      assert.equal(spalte, undefined, 'die Spalte `note` steht noch in der Tabelle');
    });

    await t.test('with the account its vouchers disappear too', async () => {
      // ON DELETE CASCADE. Without that number and PIN of a deleted
      // account would stay in the database — numbers that can still be redeemed.
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
 * The UI of the web app — Marco's touch-ups of 06.10.
 *
 * Text checks, and that is appropriate here: what is checked are
 * decisions about the PRESENTATION, and they stand nowhere else. What
 * the server does is checked by the assertions above against a real
 * database.
 */
const testUi = require('node:test');
testUi('Gutscheine in der Webapp: Marcos Nachbesserungen', async t => {
  const fsO = require('node:fs');
  // The paths below stand WRITTEN OUT and not behind a helper with a
  // variable: a `path.join(ROOT, rel)` takes away from test/eigenbruecken.test.js the
  // view of whether a test reads a file that does not exist at all — and
  // exactly this guard promptly turned red here. …
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
    const treffer = js.match(/data-click="copyVoucher"/g) || [];
    assert.equal(treffer.length, 2, `erwartet 2 Kopieren-Knoepfe, gefunden ${treffer.length}`);
    assert.match(js, /COPY_ICON_SVG/, 'der Knopf traegt kein Symbol');
    // The RAW number is copied: the groups of four are a reading aid,
    // a payment field does not accept them.
    const kopierBody = js.slice(js.indexOf('function copyVoucher'));
    assert.match(kopierBody.slice(0, 400), /String\(k\.number\)/, 'in copyVoucher wird nicht die rohe Nummer genommen');
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
    // The native field cut off its text and looked different from every
    // other file choice; now the same form (label.btn with .file-hidden).
    assert.match(
      html,
      /<label class="btn bs cursor-pointer">[\s\S]*?<input type="file" id="v-pdf"[^>]*class="file-hidden"/,
      'die Dateiwahl der Gutscheine ist kein Knopf mit verstecktem Feld',
    );
    assert.ok(!/\.voucher-upload input\[type=file\]/.test(css), 'die Regel fuer das native Feld steht noch da');
  });
});
