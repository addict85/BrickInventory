/**
 * Jede Route des Vertrags, von einem fremden Konto mit Kennungen und Konto-IDs
 * des Opfers gerufen (einmal mit dessen Konto-ID in Feldern, einmal mit der
 * eigenen): Keine Antwort enthält Daten des Opfers, keine seiner Zeilen ändert
 * sich. Ausgelassen: Routen vor der Anmeldung und das Löschen des eigenen Kontos.
 *
 * Gegenproben (09.11.2026 gemessen, je einzeln):
 *   A  in gutscheinLoeschen() (src/gutscheine/repository) `user_id = $2`
 *      durch `$2::int > 0` ersetzt → rot: „keine Zeile des Opfers ändert sich“
 *   B  in blickfeldIds() (src/haushalt) eine angefragte Konto-ID ohne Prüfung der
 *      Mitgliedschaft übernommen → rot: „keine Antwort enthält Daten des
 *      Opfers“ und „keine Zeile des Opfers ändert sich“
 *   Grün blieb dagegen das Entfernen der Besitzprüfung nur beim Umbenennen
 *   oder Löschen eines Lagerorts: Dort prüft der Dienst den Besitz vorher
 *   schon einmal (ortName), die zweite Stelle ist Rückhalt.
 *
 * Voraussetzung: Test-DB via TEST_DATABASE_URL.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';
process.env.APP_BASE_URL = 'http://localhost';
process.env.SESSION_SECRET = 'test-secret-lang-genug-fuer-die-pruefung';

const ROOT = path.join(__dirname, '..');
const S = require('./helpers/sources');
const { katalogSet } = require('./helpers/bestand');
const _req = S.buildAndRequire();
const { dbOderSkip } = require('./helpers/db');
const { mailAttrappe } = require('./helpers/mail-attrappe');
mailAttrappe();
const db = _req('db/database.js');
const auth = _req('src/konto/geraeteToken.js');
const { VERTRAG } = _req('src/vertrag/index.js');
const express = require(path.join(ROOT, 'node_modules', 'express'));
const bcrypt = require(path.join(ROOT, 'node_modules', 'bcryptjs'));
const PDFDocument = require('pdfkit');

const MARKE = `GEHEIM${process.pid}`;
const OPFER = `opfer_${MARKE}`,
  FREMD = `fremd_${process.pid}`,
  PASS = 'Fremd-Passwort-1!';
const SET = '99181-1',
  SET2 = '99182-1',
  SET3 = '99183-1',
  TEIL = '3001fk',
  FARBE = 5,
  FIGUR = 'fk0001';
const GUTSCHEIN = '5045076374450019876';
const VOR_DER_ANMELDUNG =
  /^(POST|GET) \/api\/v1\/auth\/(login|register|forgot-password|reset-password|verify[\w/-]*|resend-verification|qr-login[\w/-]*|passkey\/anmelden[\w/-]*|name-frei|email-frei)$/;

function pdfMit(zeilen) {
  return new Promise(fertig => {
    const doc = new PDFDocument({ compress: false });
    const stuecke = [];
    doc.on('data', s => stuecke.push(s));
    doc.on('end', () => fertig(Buffer.concat(stuecke)));
    for (const z of zeilen) doc.text(z);
    doc.end();
  });
}

/** Ein Beispielwert für ein zod-Schema; `name` ist der Feldname, `wert` liefert die Werte des Opfers. */
function beispiel(schema, name, wert, alle) {
  const d = schema?._zod?.def;
  if (!d) return undefined;
  if (name && wert(name) !== undefined) return wert(name);
  switch (d.type) {
    case 'optional':
    case 'nullable':
    case 'default':
    case 'prefault':
    case 'readonly':
    case 'catch':
      return beispiel(d.innerType, name, wert, alle);
    case 'pipe':
      return beispiel(d.in, name, wert, alle);
    case 'union':
      for (const o of d.options) {
        const v = beispiel(o, name, wert, alle);
        if (v !== undefined) return v;
      }
      return undefined;
    case 'enum':
      return Object.values(d.entries)[0];
    case 'literal':
      return d.values[0];
    case 'string':
      return 'x';
    case 'number':
    case 'int':
      return 1;
    case 'boolean':
      return true;
    case 'array': {
      const e = beispiel(d.element, null, wert, alle);
      return e === undefined ? [] : [e];
    }
    case 'record':
      return {};
    case 'object': {
      const aus = {};
      for (const [k, s] of Object.entries(d.shape)) {
        const optional = ['optional', 'default', 'prefault'].includes(s?._zod?.def?.type);
        if (optional && !alle && wert(k) === undefined) continue;
        const v = beispiel(s, k, wert, alle);
        if (v !== undefined) aus[k] = v;
      }
      return aus;
    }
    default:
      return undefined;
  }
}

test('ein fremdes Konto sieht und ändert über keine Route Daten des anderen', {
  concurrency: 1,
  timeout: 600_000,
}, async t => {
  if (!(await dbOderSkip(t, _req))) return;

  await db.run('DELETE FROM users WHERE username = ANY($1)', [[OPFER, FREMD]]);
  const hash = await bcrypt.hash(PASS, 4);
  const anlegen = async n =>
    (
      await db.get(
        `INSERT INTO users (username, email, password_hash, is_admin, is_active, email_verified)
     VALUES ($1, $2, $3, false, true, true) RETURNING id`,
        [n, `${n}@example.org`, hash],
      )
    ).id;
  const opfer = await anlegen(OPFER),
    fremd = await anlegen(FREMD);
  for (const k of [opfer, fremd])
    await db.run(
      `INSERT INTO user_settings (user_id, key, value) VALUES ($1, 'currency', 'EUR')
                  ON CONFLICT (user_id, key) DO UPDATE SET value = 'EUR'`,
      [k],
    );
  t.after(async () => {
    await db.run('DELETE FROM users WHERE id = ANY($1)', [[opfer, fremd]]).catch(() => {});
    for (const tab of ['set_catalog', 'set_parts_catalog', 'set_minifigs_catalog'])
      await db.run(`DELETE FROM ${tab} WHERE set_number = ANY($1)`, [[SET, SET2, SET3]]).catch(() => {});
    await db.run('DELETE FROM part_color_catalog WHERE part_number = $1', [TEIL]).catch(() => {});
    await db.run('DELETE FROM part_catalog WHERE part_number = $1', [TEIL]).catch(() => {});
    await db.run('DELETE FROM minifigs_catalog WHERE fig_number = $1', [FIGUR]).catch(() => {});
    await db.pool.end().catch(() => {});
  });

  for (const s of [SET, SET2, SET3])
    await katalogSet(db, s, { name: 'Fremdprobe', year: 2024, theme: 'Test', pieces: 10, minifigs: 1 });
  await db.run(
    `INSERT INTO part_catalog (part_number, part_name, category_name) VALUES ($1, 'Stein 2x2', 'Steine')
                ON CONFLICT DO NOTHING`,
    [TEIL],
  );
  await db.run(
    `INSERT INTO part_color_catalog (part_number, color_id, color_name, color_hex) VALUES ($1, $2, 'Rot', 'C91A09')
                ON CONFLICT DO NOTHING`,
    [TEIL, FARBE],
  );
  await db.run(`INSERT INTO minifigs_catalog (fig_number, fig_name) VALUES ($1, 'Probefigur') ON CONFLICT DO NOTHING`, [
    FIGUR,
  ]);

  // ── Server wie in server.ts; die Sitzung wechselt zwischen den Konten ──
  let als = opfer;
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    const name = als === opfer ? OPFER : FREMD;
    req.session = {
      userId: als,
      username: name,
      isAdmin: false,
      regenerate(cb) {
        cb();
      },
      save(cb) {
        cb?.();
      },
      destroy(cb) {
        cb?.();
      },
    };
    req.apiUser = { user_id: als, username: name, is_admin: 0 };
    next();
  });
  app.use('/api/v1', _req('routes/api_v1/index.js'));
  for (const r of S.routerEinhaengungen()) app.use(r.mount, _req(`routes/${r.name}.js`));
  const srv = app.listen(0);
  t.after(async () => {
    srv.closeAllConnections?.();
    await new Promise(r => srv.close(r));
    // LISTEN-Verbindung und Zeitgeber, die Routen nebenher anstossen, hielten den Prozess sonst offen.
    await _req('db/database.js')
      .standardDb()
      .benachrichtigung.close()
      .catch(() => {});
  });
  const basis = `http://127.0.0.1:${srv.address().port}`;

  const ruf = async (methode, weg, body, form) => {
    const init = { method: methode, signal: AbortSignal.timeout(4000) };
    if (form) init.body = form;
    else if (body !== undefined) {
      init.body = JSON.stringify(body);
      init.headers = { 'content-type': 'application/json' };
    }
    try {
      const r = await fetch(basis + weg, init);
      return { status: r.status, text: Buffer.from(await r.arrayBuffer()).toString('latin1') };
    } catch (e) {
      return { status: 0, text: String(e?.name) };
    }
  };
  const ok = async (methode, weg, body, form) => {
    const r = await ruf(methode, weg, body, form);
    assert.equal(r.status, 200, `${methode} ${weg}: ${r.text.slice(0, 300)}`);
    return JSON.parse(r.text);
  };

  // ── Das Opfer legt über die API an, was es besitzt ──────────────────────
  const ort = (await ok('POST', '/api/v1/storage/locations', { name: `Ort ${MARKE}` })).ort.id;
  await ok('POST', '/api/v1/sets', { set_number: SET, quantity: 1, purchase_price: 12.34, condition: 'N' });
  await ok('PUT', `/api/v1/sets/${SET}/storage`, { storage: `Ort ${MARKE}` });
  await ok('PUT', `/api/v1/sets/${SET}/alert`, { richtung: 'unter', schwelle: 30, condition: 'N' });
  const setAcq = (await db.get('SELECT id FROM set_acquisitions WHERE user_id = $1 AND set_number = $2', [opfer, SET]))
    .id;
  const pdf = await pdfMit(['Bauanleitung']);
  const f = new FormData();
  f.append('file', new Blob([pdf], { type: 'application/pdf' }), 'anleitung.pdf');
  f.append('description', `Anleitung ${MARKE}`);
  await ok('POST', `/api/v1/sets/${SET}/instructions/upload`, undefined, f);
  const anleitung = (await db.get('SELECT id FROM instructions WHERE user_id = $1 ORDER BY id DESC LIMIT 1', [opfer]))
    .id;
  await ok('POST', '/api/v1/parts', {
    part_number: TEIL,
    color_id: FARBE,
    color_name: 'Rot',
    quantity: 3,
    unit_price: 0.2,
    condition: 'N',
  });
  await ok('PUT', `/api/v1/parts/${TEIL}/${FARBE}/storage`, { storage: `Kiste ${MARKE}` });
  const teilAcq = (await db.get('SELECT id FROM part_acquisitions WHERE user_id = $1', [opfer])).id;
  await ok('POST', '/api/v1/minifigs', { fig_number: FIGUR, quantity: 1, unit_price: 4, condition: 'N' });
  const figAcq = (await db.get('SELECT id FROM minifig_acquisitions WHERE user_id = $1', [opfer])).id;
  await ok('POST', '/api/v1/wanted', { set_number: SET2, condition: 'N' });
  const gutschein = (
    await ok('POST', '/api/v1/vouchers', { number: GUTSCHEIN, pin: '4711', amount: 50, currency: 'CHF' })
  ).voucher.id;
  await ok('POST', '/api/v1/sets', { set_number: SET3, quantity: 1, condition: 'N' });
  await ok('DELETE', `/api/v1/sets/${SET3}`);
  const papierkorb = (await db.get('SELECT id FROM papierkorb WHERE user_id = $1', [opfer])).id;
  const token = await auth.createToken(opfer, `Gerät ${MARKE}`, true);
  const nonce = `fremd${process.pid}${Date.now()}`;
  const qr = (
    await db.get(
      `INSERT INTO qr_login_tokens (token, user_id, expires_at, abholung, code_hash)
    VALUES ($1, $2, NOW() + INTERVAL '5 minutes', 'abh', 'x') RETURNING id`,
      [auth.hashToken(nonce), opfer],
    )
  ).id;

  /** Was das Opfer besitzt, Zeile für Zeile; danach darf sich davon nichts geändert haben. */
  const spalten = await db.all(`SELECT table_name, column_name FROM information_schema.columns
    WHERE table_schema = current_schema() AND column_name IN ('user_id', 'owner_user_id', 'main_user_id', 'sub_user_id')`);
  const bestand = async () => {
    const aus = { users: await db.all('SELECT * FROM users WHERE id = $1', [opfer]) };
    for (const { table_name: tab, column_name: sp } of spalten) {
      const zeilen = await db.all(`SELECT * FROM "${tab}" WHERE "${sp}" = $1`, [opfer]);
      aus[`${tab}.${sp}`] = zeilen.map(z => JSON.stringify(z)).sort();
    }
    return aus;
  };
  const vorher = await bestand();
  const zeilenDesOpfers = Object.values(vorher).reduce((n, z) => n + z.length, 0);
  assert.ok(zeilenDesOpfers >= 15, `nur ${zeilenDesOpfers} Zeilen des Opfers angelegt`);

  // ── Werte des Opfers für Pfad, Abfrage und Rumpf ───────────────────────
  const idFuer = p =>
    p.includes('/storage/locations/')
      ? ort
      : p.includes('/papierkorb/')
        ? papierkorb
        : p.includes('/vouchers/')
          ? gutschein
          : p.includes('/qr-kopplung/')
            ? qr
            : p.includes('/parts/')
              ? teilAcq
              : p.includes('/minifigs/')
                ? figAcq
                : opfer;
  const acqFuer = p => (p.startsWith('/api/v1/parts') ? teilAcq : p.startsWith('/api/v1/minifigs') ? figAcq : setAcq);
  const pfadWert = (p, n) =>
    ({
      setNumber: p.includes('/wanted/') ? SET2 : SET,
      sn: SET,
      partNumber: TEIL,
      colorId: FARBE,
      figNumber: FIGUR,
      id: idFuer(p),
      acqId: acqFuer(p),
      instrId: anleitung,
      tokenId: auth.hashToken(token).slice(0, 16),
      jobId: '1700000000000-abcd',
      condition: 'N',
      art: 'anleitung',
      barcode: '5702016616354',
    })[n];
  /** `konto`: das Opfer (fremde Konto-ID im Feld) oder das eigene — dann kommt die Anfrage an der
   * Kontoprüfung vorbei und trifft mit den Kennungen des Opfers die Besitzprüfung der Zeile. */
  const feldWert = (k, konto) =>
    ({
      accounts: String(konto),
      owner: String(konto),
      owner_user_id: konto,
      from_user_id: konto,
      sub_user_id: konto,
      main_user_id: konto,
      to_user_id: konto,
      neuer_inhaber: fremd,
      id: ort,
      acquisition_ids: [setAcq],
      set_number: SET,
      sets: [SET],
      set_numbers: [SET],
      part_number: TEIL,
      color_id: FARBE,
      fig_number: FIGUR,
      teile: [{ part_number: TEIL, color_id: FARBE }],
      parts: [{ part_number: TEIL, color_id: FARBE }],
      condition: 'N',
      storage: 'Lager des Fremden',
      name: 'Name des Fremden',
      search: 'GEHEIM',
      q: 'GEHEIM',
      // Das eigene Passwort: Bestätigen kann der Angreifer im eigenen Konto, gefragt ist der Besitz dahinter.
      password: PASS,
      admin_password: PASS,
      current: PASS,
      password_current: PASS,
      number: '5045076374450010001',
      pin: '0001',
      passkey: undefined,
      date: '2024-01-01',
      acquired_at: '2024-01-01',
    })[k];
  const abfrageWert = (k, konto) => {
    const v = feldWert(k, konto);
    return v === undefined ? undefined : Array.isArray(v) ? v.join(',') : String(v);
  };

  // ── Das fremde Konto ruft jede Route mit diesen Werten ──────────────────
  als = fremd;
  const lecks = [],
    gerufen = [];
  for (const [schluessel, route] of Object.entries(VERTRAG)) {
    if (VOR_DER_ANMELDUNG.test(schluessel) || schluessel === 'DELETE /api/v1/auth/konto') continue;
    const [methode, muster] = schluessel.split(' ');
    const weg = muster.replace(/:(\w+)/g, (_, n) => encodeURIComponent(String(pfadWert(muster, n) ?? 'x')));
    const felder = route.abfrage?.shape ? Object.keys(route.abfrage.shape) : [];
    for (const konto of [opfer, fremd]) {
      const w = k => feldWert(k, konto);
      const abfrage = new URLSearchParams(
        felder.map(k => [k, abfrageWert(k, konto)]).filter(([, v]) => v !== undefined),
      ).toString();
      const rumpfe =
        methode === 'GET' || route.formular
          ? [undefined]
          : [beispiel(route.eingabe, null, w, false), beispiel(route.eingabe, null, w, true)];
      for (const rumpf of rumpfe)
        for (const q of abfrage ? [abfrage, ''] : ['']) {
          const r = await ruf(methode, weg + (q ? '?' + q : ''), rumpf);
          gerufen.push(`${schluessel} ${r.status}`);
          for (const geheim of [MARKE, GUTSCHEIN])
            if (r.text.includes(geheim))
              lecks.push(`${schluessel}${q ? '?' + q : ''} → ${r.status}: enthält ${geheim}`);
        }
    }
  }
  als = opfer;

  await t.test('jede Route wurde gerufen', () => {
    const routen = new Set(gerufen.map(g => g.split(' ').slice(0, 2).join(' ')));
    assert.ok(routen.size >= 180, `nur ${routen.size} Routen gerufen`);
    // Ohne erreichte Prüfung beweist das Ganze nichts: Ein guter Teil muss durch die Eingabeprüfung kommen.
    const durch = gerufen.filter(g => !/ (400|0)$/.test(g)).length;
    assert.ok(
      durch >= gerufen.length / 2,
      `nur ${durch} von ${gerufen.length} Aufrufen kamen an der Eingabeprüfung vorbei`,
    );
  });

  await t.test('keine Antwort enthält Daten des Opfers', () => assert.deepEqual(lecks, []));

  await t.test('keine Zeile des Opfers ändert sich', async () => {
    const nachher = await bestand();
    const geaendert = Object.keys(vorher).filter(k => JSON.stringify(vorher[k]) !== JSON.stringify(nachher[k]));
    assert.deepEqual(
      geaendert.map(k => [k, vorher[k].length, nachher[k].length]),
      [],
    );
  });
});
