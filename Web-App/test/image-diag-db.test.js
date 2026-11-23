/**
 * Image diagnosis: “Why is the image missing for set X?" in ONE response.
 *
 * Counter-check (performed): the hint block for “preview missing" removed →
 * substep A turns red.
 * Counter-checks (22.11.2026, each alone): in downloadSetImage the line for a non-200 status, for a failed
 * fetch, or for a too small answer removed → red “the set image download reports every failure”.
 *
 * Prerequisite: test DB via TEST_DATABASE_URL. Without DB: skip.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';

const { buildAndRequire, testData } = require('./helpers/sources');
const _req = buildAndRequire();
const { dataOrSkip } = require('./helpers/db');
const { testServer } = require('./helpers/server');
const { adminWithFactor } = require('./helpers/admin');
const { holdsSet, catalogSet } = require('./helpers/inventory');
const db = testData();

test('the image diagnostics describe every situation in plain text', { concurrency: 1 }, async t => {
  if (!(await dataOrSkip(t, _req, { runMigrate: false }))) return;

  const { Jimp } = require(path.join(ROOT, 'node_modules', 'jimp'));
  const { DATA_DIR } = _req('src/infra/appPaths.js');
  const ordner = path.join(DATA_DIR, 'images', 'sets');
  fs.mkdirSync(ordner, { recursive: true });

  const USER = `diag-${process.pid}`;
  const MIT = `9000-${process.pid}`; // file present
  const OHNE = `9001-${process.pid}`; // nothing present
  const original = path.join(ordner, `${MIT}.jpg`);
  const preview = path.join(ordner, `${MIT}_thumb.jpg`);

  await db.run(`DELETE FROM users WHERE username=$1`, [USER]);
  await db.run(`INSERT INTO users (username,password_hash,is_admin) VALUES ($1,'x',true)`, [USER]);
  const uid = (await db.get(`SELECT id FROM users WHERE username=$1`, [USER])).id;
  await db.run(`DELETE FROM sets WHERE set_number = ANY($1)`, [[MIT, OHNE]]);
  await db.run(`DELETE FROM set_catalog WHERE set_number = ANY($1)`, [[MIT, OHNE]]);
  // The stock only says “this account holds the set"; name and image path
  // have been in the catalog since migration 0033.
  await holdsSet(db, uid, MIT, 1);
  await catalogSet(db, MIT, { name: 'Mit Bild', image_local: `/images/sets/${MIT}.jpg` });
  await holdsSet(db, uid, OHNE, 1);
  await catalogSet(db, OHNE, { name: 'Ohne alles' });
  await new Jimp({ width: 500, height: 400, color: 0x0000ffff }).write(original);
  fs.rmSync(preview, { force: true });

  await adminWithFactor(_req, uid);
  const { base, srv } = testServer(_req, { sitzung: { userId: uid, isAdmin: true }, t });
  const frag = async sn => {
    const r = await fetch(`${base}/api/v2/admin/image-diag/${sn}`);
    assert.equal(r.status, 200, 'the diagnosis must answer');
    return r.json();
  };

  try {
    // A) Exactly Marco's situation: original present, preview missing.
    let d = await frag(MIT);
    assert.equal(d.local.original.existing, true, 'the original must be found');
    assert.equal(d.local.preview.existing, false);
    assert.ok(
      d.hints.some(h => /Vorschau fehlt/.test(h)),
      `the diagnosis must name the missing preview, got: ${d.hints.join(' | ')}`,
    );

    // B) Nothing known — neither file nor address.
    d = await frag(OHNE);
    assert.ok(
      d.hints.some(h => /Weder lokale Datei noch CDN-Adresse/.test(h)),
      `the diagnosis must name „nichts anzeigbar“, got: ${d.hints.join(' | ')}`,
    );

    // C) After generation everything is together — and the sizes are right.
    await _req('src/images/thumbs.js').previewFrom(`/images/sets/${MIT}.jpg`);
    d = await frag(MIT);
    assert.ok(
      d.hints.some(h => /Alles vorhanden/.test(h)),
      `after the generation nothing may be flagged anymore, got: ${d.hints.join(' | ')}`,
    );
    assert.ok(d.local.preview.bytes < d.local.original.bytes, 'the reported preview must be smaller than the original');

    // The diagnosis must repair NOTHING — otherwise the tool changes the
    // state it is supposed to describe.
    fs.rmSync(preview, { force: true });
    await frag(MIT);
    assert.equal(fs.existsSync(preview), false, 'the diagnosis created the preview — it should only observe');
  } finally {
    await db.run(`DELETE FROM users WHERE username=$1`, [USER]).catch(() => {});
    await db.run(`DELETE FROM sets WHERE set_number = ANY($1)`, [[MIT, OHNE]]).catch(() => {});
    fs.rmSync(original, { force: true });
    fs.rmSync(preview, { force: true });
    await new Promise(r => srv.close(r));
    await db.pool.end().catch(() => {});
  }
});

test('the set image download reports every failure', async t => {
  // Every way to fail leaves a line with set number and reason; the fetch is replaced at the wiring.
  const { FetchError } = _req('src/infra/fetch.js');
  /** @type {Record<string, () => Promise<any>>} */
  const answers = {
    'http-403': async () => ({ status: 403 }),
    'http-404': async () => ({ status: 404 }),
    netz: async () => {
      throw new Error('ECONNRESET');
    },
    gross: async () => {
      throw new FetchError('zu-gross', 'zu gross');
    },
    klein: async () => ({ status: 200, body: Buffer.from('<html>') }),
  };
  let current = 'netz';
  require('./helpers/sources').testSources(t, { fetchImage: async () => answers[current]() });
  const lines = [];
  t.mock.method(console, 'error', (...a) => lines.push(a.join(' ')));
  t.mock.method(console, 'warn', (...a) => lines.push(a.join(' ')));
  const { downloadSetImage } = _req('src/images/setImages.js');
  const reasons = {};
  for (const kind of Object.keys(answers)) {
    current = kind;
    const sn = `zzdiag-${kind}-${process.pid}`;
    lines.length = 0;
    assert.equal(await downloadSetImage(`https://cdn.rebrickable.com/media/sets/${sn}.jpg`, sn), null, kind);
    reasons[kind] = lines.filter(l => l.includes(sn)).length;
  }
  assert.deepEqual(reasons, { 'http-403': 1, 'http-404': 1, netz: 1, gross: 1, klein: 1 });
});
