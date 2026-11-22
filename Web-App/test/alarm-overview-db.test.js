/**
 * All price alerts in ONE place — and editable and deletable there.
 *
 * ── Counter-checks (performed, result in the commit) ────────────────────────
 *   a) `WHERE a.user_id = $1` removed       → step 2 red (foreign alert included)
 *   b) LEFT JOIN → INNER JOIN               → step 3 red (unknown set gone)
 *   c) section removed from index.html      → step 4 red
 *   d) ladeAlarmUebersicht not called       → step 4 red
 *   e) second LEFT JOIN on `sets` removed   → step 5 red (image and ownership)
 *   f) `data-click="stopEvent"` removed from the field → step 6 red
 *   g) `besitzt` removed from data class Preisalarm, interface regenerated → step 7 red
 *   h) 'alerts.fired' reset to “hat gemeldet" → step 8 red
 *   i) font-weight:600 removed from .alert-badge-on → step 8 red
 *   j) join back to `s.user_id = a.user_id` → step 9 red
 *   k) DISTINCT ON removed → step 9 red (alert appears twice)
 */
require('./helpers/system-frame');
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';

const { buildAndRequire, loadTranslations, ohneKommentare, testData } = require('./helpers/sources');
const { catalogSet } = require('./helpers/inventory');
const _req = buildAndRequire();
const { dataOrSkip } = require('./helpers/db');
const db = testData();

test('price alert overview: own alerts, with names, changeable, deletable', { concurrency: 1 }, async t => {
  if (!(await dataOrSkip(t, _req))) return;

  const { allAlerts, setAlert, deleteAlert } = {
    ..._req('src/finances/priceAlert.js'),
    ...require('./helpers/sources').testArea('finances').preisalarm,
  };

  for (const n of ['alarm_ich', 'alarm_fremd', 'alarm_kind'])
    await db.run('DELETE FROM users WHERE username = $1', [n]);
  const ich = await db.get(
    "INSERT INTO users (username,password_hash,is_admin,email_verified) VALUES ($1,'x',false,true) RETURNING id",
    ['alarm_ich'],
  );
  const fremd = await db.get(
    "INSERT INTO users (username,password_hash,is_admin,email_verified) VALUES ($1,'x',false,true) RETURNING id",
    ['alarm_fremd'],
  );
  // A sub-account in the HOUSEHOLD. Exactly this is where the first version failed:
  // it joined on `s.user_id = a.user_id`, i.e. strictly the own account —
  // a set of the child thus counted as “does not exist", although the
  // detail view does open it (it queries via scopeIds()).
  const kind = await db.get(
    "INSERT INTO users (username,password_hash,is_admin,email_verified) VALUES ($1,'x',false,true) RETURNING id",
    ['alarm_kind'],
  );
  await db.run('INSERT INTO account_links (main_user_id, sub_user_id) VALUES ($1,$2)', [ich.id, kind.id]);

  t.after(async () => {
    for (const id of [ich.id, fremd.id, kind.id]) await db.run('DELETE FROM users WHERE id = $1', [id]).catch(() => {});
    await db.run("DELETE FROM rb_sets WHERE set_num = '60000-1'").catch(() => {});
    await db.run("DELETE FROM rb_sets WHERE set_num = '70002-1'").catch(() => {});
    await db.pool.end().catch(() => {});
  });

  // A set the catalog knows — and one it does NOT know.
  await db.run(`INSERT INTO rb_sets (set_num, name, set_img_url)
                VALUES ('70002-1','Lennox Feuerwehr','https://cdn.example/70002-1.jpg')
                ON CONFLICT (set_num) DO UPDATE
                   SET name = EXCLUDED.name, set_img_url = EXCLUDED.set_img_url`);
  // The same set is ADDITIONALLY in my collection — only then is there a
  // detail dialog, and only then is there the downloaded image.
  await db.run(
    `INSERT INTO sets (user_id, set_number)
                VALUES ($1,'70002-1')
                ON CONFLICT (user_id, set_number) DO NOTHING`,
    [ich.id],
  );
  await catalogSet(db, '70002-1', {
    name: 'Lennox Feuerwehr',
    image_local: '/uploads/70002-1_thumb.jpg',
    image_url: 'https://cdn.example/70002-1.jpg',
  });

  // Signature READ, not guessed: (userId, setNumber, waehrung, eingabe).
  // The first draft of this test had made it up and ran
  // straight into “Die Richtung muss unter oder ueber sein" — the values landed
  // in the wrong places.
  await setAlert(ich.id, '70002-1', 'CHF', { direction: 'below', threshold: 30, condition: 'N' });
  await setAlert(ich.id, '99999-9', 'CHF', { direction: 'above', threshold: 500, condition: 'U' }); // set unknown
  await setAlert(fremd.id, '70002-1', 'CHF', { direction: 'below', threshold: 10, condition: 'N' }); // fremd

  // The CHILD's set — I do not own it, but I see it in the view.
  await db.run(`INSERT INTO rb_sets (set_num, name, set_img_url)
                VALUES ('60000-1','Feuerwehreinsatz','https://cdn.example/60000-1.jpg')
                ON CONFLICT (set_num) DO NOTHING`);
  await db.run(
    `INSERT INTO sets (user_id, set_number)
                VALUES ($1,'60000-1')
                ON CONFLICT (user_id, set_number) DO NOTHING`,
    [kind.id],
  );
  await catalogSet(db, '60000-1', { name: 'Feuerwehreinsatz', image_local: '/uploads/60000-1_thumb.jpg' });
  await setAlert(ich.id, '60000-1', 'CHF', { direction: 'below', threshold: 40, condition: 'N' });

  // The same set TWICE in the household — with me and with the child. Since the
  // join goes via the view, it can hit several rows;
  // without DISTINCT ON the alert would appear twice in the list.
  await db.run(
    `INSERT INTO sets (user_id, set_number)
                VALUES ($1,'70002-1')
                ON CONFLICT (user_id, set_number) DO NOTHING`,
    [kind.id],
  );

  await t.test('1. all own alerts come', async () => {
    const a = await allAlerts(ich.id);
    assert.equal(a.length, 3, `Expected 3 own alerts, got: ${a.length}`);
    // numeric comes from the driver as a string — the overview computes
    // with it (field, comparison), so a NUMBER must arrive here.
    assert.equal(typeof a[0].threshold, 'number', 'The threshold does not arrive as a number.');
  });

  await t.test('2. and NO foreign one', async () => {
    const a = await allAlerts(ich.id);
    assert.ok(
      !a.some(x => Number(x.threshold) === 10),
      'The alert of the other account is in my overview — the missing ' +
        'user_id criterion looks harmless in the source and is the whole bug.',
    );
    assert.equal((await allAlerts(fremd.id)).length, 1, 'The other account suddenly sees more.');
  });

  await t.test('3. with set name — and an unknown set does not drop out', async () => {
    const a = await allAlerts(ich.id);
    const bekannt = a.find(x => x.set_number === '70002-1');
    const unbekannt = a.find(x => x.set_number === '99999-9');
    assert.equal(bekannt.name, 'Lennox Feuerwehr', 'Without names the list is a list of numbers — nobody reads that.');
    assert.ok(
      unbekannt,
      'An alert on a set the catalog does not know has disappeared. ' +
        'But that is exactly the row one looks for, because it behaves oddly (INNER instead of LEFT JOIN).',
    );
    assert.equal(unbekannt.name, null, 'Unknown means null, not guessed as empty.');
  });

  await t.test('4. the section is in the web app and gets loaded', () => {
    const html = fs.readFileSync(path.join(ROOT, 'public/index.html'), 'utf8');
    assert.match(html, /id="alerts-list"/, 'The section is missing in the markup.');
    assert.match(html, /data-i18n="alerts\.group"/, 'The section has no heading.');
    const galerie = ohneKommentare(fs.readFileSync(path.join(ROOT, 'public/js/navigation.js'), 'utf8'));
    assert.match(
      galerie,
      /loadAlertOverview\(\)/,
      'Opening the settings does not load the overview — the section would stay empty.',
    );
    const js = ohneKommentare(require('./helpers/sources').ansichtQuelle('settings'));
    // Changing and deleting go via the EXISTING route to the set: two
    // write paths to the same state would be two places where the rules
    // auseinanderlaufen.
    assert.match(
      js,
      /'PUT', `\/v2\/sets\/\$\{encodeURIComponent\(setNumber\)\}\/alert`/,
      'Der Wert lässt sich nicht ändern — genau das hat Marco verlangt.',
    );
    assert.match(js, /'DELETE', `\/v2\/sets\//, 'The alert cannot be deleted — exactly what Marco asked for.');
  });

  await t.test('5. image and ownership come along — for the tile and for the click', async () => {
    const a = await allAlerts(ich.id);
    const meins = a.find(x => x.set_number === '70002-1');
    const fremdes = a.find(x => x.set_number === '99999-9');
    // Order as in the finances: downloaded copy first. Without it
    // the same number would show a different image in the overview than in the
    // gallery next to it.
    assert.equal(
      meins.image_local,
      '/uploads/70002-1_thumb.jpg',
      'The image of the own collection is missing — the row would stay without a tile or ' +
        'show a different one than the gallery.',
    );
    assert.equal(
      meins.set_img_url,
      'https://cdn.example/70002-1.jpg',
      'The catalog image is missing — it is the fallback for sets one does not own.',
    );
    assert.equal(meins.owns, true, 'A set in the collection counts as not owned.');
    // The second LEFT JOIN must not multiply any row: sets is unique over
    // (user_id, set_number). Two rows would be the proof here.
    assert.equal(
      a.filter(x => x.set_number === '70002-1').length,
      1,
      'The join with the own collection multiplied the row.',
    );

    assert.equal(
      fremdes.owns,
      false,
      'An alert on a set that is NOT in the collection counts as owned — ' +
        'the row would be clickable and the click would end in an error message.',
    );
    assert.equal(fremdes.image_local, null, 'Where should the image come from?');
  });

  await t.test('6. the row opens the detail dialog, the number field does not', () => {
    const js = ohneKommentare(require('./helpers/sources').ansichtQuelle('settings'));
    assert.match(
      js,
      /data-click="openModal"/,
      'The row does not open the detail dialog — exactly what Marco asked for.',
    );
    // The dispatcher in aktionen.js takes the NEAREST element with
    // data-click. Without `stopEvent` on the input field every click into the field opened
    // the dialog above the field one was just about to type into.
    assert.match(js, /data-click="stopEvent"/, 'The number field does not stop the click — typing opened the dialog.');
    assert.match(js, /thumbUrl\(/, 'Die Zeile zeigt kein Vorschaubild — analog den Finanzen war das der Auftrag.');
  });

  await t.test('7. every delivered field also arrives in the app', async () => {
    const a = await allAlerts(ich.id);
    const felder = Object.keys(a[0]);
    assert.ok(felder.length >= 10, `Only ${felder.length} fields — query broken?`);
    // The app's model (shared/app-schnittstelle.json, generated from its source text).
    const app = require('./helpers/contract').appInterface().modelle.Preisalarm?.felder ?? [];
    assert.ok(app.includes('set_number'), 'Model „Preisalarm“ not found — renamed?');
    // The app reads API v1, so a field arrives under its v1 name.
    const { v1Field } = _req('src/contract/v1.js');
    const fehlen = felder.filter(k => !app.includes(v1Field(undefined, k)));
    assert.deepEqual(
      fehlen,
      [],
      `/v2/alerts delivers these fields, and the app has no place for them:\n  ${fehlen.join('\n  ')}\nThey would arrive there as null, without an error and without a hint.`,
    );
  });

  await t.test('8. armed/disarmed is recognizable without color', () => {
    // Marco's finding from 26.09.
    const js = ohneKommentare(require('./helpers/sources').ansichtQuelle('settings'));
    const css = fs.readFileSync(path.join(ROOT, 'public/styles.css'), 'utf8');

    // 1. The marker comes from a class, not from a color in the markup.
    //    As long as the color stands directly at the spot, it is the only thing
    //    that separates the two states.
    assert.match(js, /alert-badge-on/, 'The armed state has no class of its own.');
    assert.match(js, /alert-badge-off/, 'The disarmed state has no class of its own.');
    assert.ok(
      !/alerts\.armed'\)\}<\/span>/.test(js) || !/var\(--ok/.test(js),
      'Die Marke färbt noch direkt im Markup — dann hängt die Aussage wieder an der Farbe.',
    );

    // 2. The AREA distinguishes: filled versus outlined. That is the
    //    difference one sees even when both colors look
    //    the same.
    const an = (css.match(/\.alert-badge-on\{([^}]*)\}/) || [])[1] || '';
    const aus = (css.match(/\.alert-badge-off\{([^}]*)\}/) || [])[1] || '';
    assert.ok(an && aus, 'The two classes are not styled.');
    assert.match(an, /background:var\(--s200\)/, 'The armed state is not filled.');
    assert.match(aus, /border-color:var\(--bdr\)/, 'The disarmed state is not outlined.');
    assert.match(an, /font-weight:600/, 'The font weight does not distinguish the two either — one feature less.');

    // 3. The WORD is a pair, in BOTH languages. Previously it was “scharf"
    //    versus “hat gemeldet" — two statements about different things; whoever
    //    cannot read the color had to infer the contrast.
    const { de, en } = loadTranslations();
    for (const [name, w] of [
      ['DE', de],
      ['EN', en],
    ]) {
      const sharp = String(w['alerts.armed'] || '');
      const blurry = String(w['alerts.fired'] || '');
      assert.ok(sharp.includes('●'), `${name}: the filled symbol is missing for „scharf“.`);
      assert.ok(blurry.includes('○'), `${name}: the hollow symbol is missing for „unscharf“.`);
      const a = sharp.replace(/[^\p{L}]/gu, '').toLowerCase();
      const b = blurry.replace(/[^\p{L}]/gu, '').toLowerCase();
      assert.ok(
        a && b.includes(a),
        `${name}: „${sharp}“ and „${blurry}“ are no recognizable pair of opposites. ` +
          'Without color this is the only hint that one state is the ' +
          'opposite of the other.',
      );
    }
  });

  await t.test("9. a set of the HOUSEHOLD counts too — Marco's finding from 26.09.", async () => {
    // “The image in the Android app is visible but the entries in the
    // price alerts are not clickable."
    const a = await allAlerts(ich.id);
    const fromKind = a.find(x => x.set_number === '60000-1');
    assert.ok(fromKind, 'The alert on the child set is missing entirely.');
    assert.equal(
      fromKind.owns,
      true,
      'A household set counts as not owned — the row would not be ' +
        'clickable although the detail view opens it. That was exactly Marco’s finding.',
    );
    assert.equal(
      fromKind.image_local,
      '/uploads/60000-1_thumb.jpg',
      'The image does not come from the household either, only from the catalog.',
    );

    // And the flip side of the same extension: the same set is with me AND
    // with the child. Without DISTINCT ON the alert would now appear twice — a
    // bug the narrow first version could not have had.
    assert.equal(
      a.filter(x => x.set_number === '70002-1').length,
      1,
      'The alert appears twice: the set belongs to two accounts of the household, ' +
        'and the join multiplies the row.',
    );
    // The row WITH a downloaded image must win, not an arbitrary one.
    assert.equal(
      a.find(x => x.set_number === '70002-1').image_local,
      '/uploads/70002-1_thumb.jpg',
      'Of two rows the one without an image won — then the tile would stay empty ' + 'although an image exists.',
    );
  });

  await t.test('10. deleting works', async () => {
    const vorher = (await allAlerts(ich.id)).length;
    await deleteAlert(ich.id, '99999-9', 'U');
    const a = await allAlerts(ich.id);
    // Against the number measured BEFORE and not against a fixed one: whoever adds
    // an alert above should not fail here. Exactly that just
    // happened when the household case was added.
    assert.equal(a.length, vorher - 1, `After deleting there are ${a.length} alerts, before there were ${vorher}.`);
    assert.ok(!a.some(x => x.set_number === '99999-9'), 'The deleted alert is still in the overview.');
  });
});
