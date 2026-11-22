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
  await setAlert(ich.id, '70002-1', 'CHF', { direction: 'unter', threshold: 30, condition: 'N' });
  await setAlert(ich.id, '99999-9', 'CHF', { direction: 'ueber', threshold: 500, condition: 'U' }); // set unknown
  await setAlert(fremd.id, '70002-1', 'CHF', { direction: 'unter', threshold: 10, condition: 'N' }); // fremd

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
  await setAlert(ich.id, '60000-1', 'CHF', { direction: 'unter', threshold: 40, condition: 'N' });

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
    assert.equal(a.length, 3, `Erwartet 3 eigene Alarme, bekommen: ${a.length}`);
    // numeric comes from the driver as a string — the overview computes
    // with it (field, comparison), so a NUMBER must arrive here.
    assert.equal(typeof a[0].threshold, 'number', 'Die Schwelle kommt nicht als Zahl an.');
  });

  await t.test('2. and NO foreign one', async () => {
    const a = await allAlerts(ich.id);
    assert.ok(
      !a.some(x => Number(x.threshold) === 10),
      'Der Alarm des anderen Kontos steht in meiner Übersicht — das fehlende ' +
        'user_id-Kriterium sieht im Quelltext harmlos aus und ist der ganze Fehler.',
    );
    assert.equal((await allAlerts(fremd.id)).length, 1, 'Das andere Konto sieht plötzlich mehr.');
  });

  await t.test('3. with set name — and an unknown set does not drop out', async () => {
    const a = await allAlerts(ich.id);
    const bekannt = a.find(x => x.set_number === '70002-1');
    const unbekannt = a.find(x => x.set_number === '99999-9');
    assert.equal(
      bekannt.name,
      'Lennox Feuerwehr',
      'Ohne Namen ist die Liste eine Liste von Nummern — die liest niemand.',
    );
    assert.ok(
      unbekannt,
      'Ein Alarm auf ein Set, das der Katalog nicht kennt, ist verschwunden. ' +
        'Genau die Zeile sucht man aber, weil sie sich merkwürdig verhält (INNER statt LEFT JOIN).',
    );
    assert.equal(unbekannt.name, null, 'Unbekannt heisst null, nicht leer geraten.');
  });

  await t.test('4. the section is in the web app and gets loaded', () => {
    const html = fs.readFileSync(path.join(ROOT, 'public/index.html'), 'utf8');
    assert.match(html, /id="alerts-list"/, 'Die Rubrik fehlt im Markup.');
    assert.match(html, /data-i18n="alerts\.group"/, 'Die Rubrik hat keine Überschrift.');
    const galerie = ohneKommentare(fs.readFileSync(path.join(ROOT, 'public/js/navigation.js'), 'utf8'));
    assert.match(
      galerie,
      /loadAlertOverview\(\)/,
      'Beim Öffnen der Einstellungen wird die Übersicht nicht geladen — die Rubrik bliebe leer.',
    );
    const js = ohneKommentare(require('./helpers/sources').ansichtQuelle('settings'));
    // Changing and deleting go via the EXISTING route to the set: two
    // write paths to the same state would be two places where the rules
    // auseinanderlaufen.
    assert.match(
      js,
      /'PUT', `\/v1\/sets\/\$\{encodeURIComponent\(setNumber\)\}\/alert`/,
      'Der Wert lässt sich nicht ändern — genau das hat Marco verlangt.',
    );
    assert.match(js, /'DELETE', `\/v1\/sets\//, 'Der Alarm lässt sich nicht löschen — genau das hat Marco verlangt.');
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
      'Das Bild der eigenen Sammlung fehlt — die Zeile bliebe ohne Kachel oder ' +
        'zeigte eine andere als die Galerie.',
    );
    assert.equal(
      meins.set_img_url,
      'https://cdn.example/70002-1.jpg',
      'Das Katalogbild fehlt — es ist der Rückfall für Sets, die man nicht besitzt.',
    );
    assert.equal(meins.besitzt, true, 'Ein Set in der Sammlung gilt als nicht vorhanden.');
    // The second LEFT JOIN must not multiply any row: sets is unique over
    // (user_id, set_number). Two rows would be the proof here.
    assert.equal(
      a.filter(x => x.set_number === '70002-1').length,
      1,
      'Die Verbindung zur eigenen Sammlung hat die Zeile vervielfacht.',
    );

    assert.equal(
      fremdes.besitzt,
      false,
      'Ein Alarm auf ein Set, das NICHT in der Sammlung liegt, gilt als vorhanden — ' +
        'die Zeile wäre anklickbar und der Klick endete in einer Fehlermeldung.',
    );
    assert.equal(fremdes.image_local, null, 'Woher sollte das Bild kommen?');
  });

  await t.test('6. the row opens the detail dialog, the number field does not', () => {
    const js = ohneKommentare(require('./helpers/sources').ansichtQuelle('settings'));
    assert.match(
      js,
      /data-click="openModal"/,
      'Die Zeile öffnet den Detaildialog nicht — genau das hat Marco verlangt.',
    );
    // The dispatcher in aktionen.js takes the NEAREST element with
    // data-click. Without `stopEvent` on the input field every click into the field opened
    // the dialog above the field one was just about to type into.
    assert.match(js, /data-click="stopEvent"/, 'Das Zahlenfeld hält den Klick nicht auf — Tippen öffnete den Dialog.');
    assert.match(js, /thumbUrl\(/, 'Die Zeile zeigt kein Vorschaubild — analog den Finanzen war das der Auftrag.');
  });

  await t.test('7. every delivered field also arrives in the app', async () => {
    const a = await allAlerts(ich.id);
    const felder = Object.keys(a[0]);
    assert.ok(felder.length >= 10, `Nur ${felder.length} Felder — Abfrage kaputt?`);
    // The app's model (shared/app-schnittstelle.json, generated from its source text).
    const app = require('./helpers/contract').appSchnittstelle().modelle.Preisalarm?.felder ?? [];
    assert.ok(app.includes('set_number'), 'Modell Preisalarm nicht gefunden — umbenannt?');
    const fehlen = felder.filter(k => !app.includes(k));
    assert.deepEqual(
      fehlen,
      [],
      'Diese Felder liefert /v1/alerts, und die App hat keinen Platz dafür:\n  ' +
        fehlen.join('\n  ') +
        '\nSie kämen dort als null an, ohne Fehler und ohne Hinweis.',
    );
  });

  await t.test('8. armed/disarmed is recognizable without color', () => {
    // Marco's finding from 26.09.
    const js = ohneKommentare(require('./helpers/sources').ansichtQuelle('settings'));
    const css = fs.readFileSync(path.join(ROOT, 'public/styles.css'), 'utf8');

    // 1. The marker comes from a class, not from a color in the markup.
    //    As long as the color stands directly at the spot, it is the only thing
    //    that separates the two states.
    assert.match(js, /alert-badge-on/, 'Der scharfe Zustand hat keine eigene Klasse.');
    assert.match(js, /alert-badge-off/, 'Der unscharfe Zustand hat keine eigene Klasse.');
    assert.ok(
      !/alerts\.armed'\)\}<\/span>/.test(js) || !/var\(--ok/.test(js),
      'Die Marke färbt noch direkt im Markup — dann hängt die Aussage wieder an der Farbe.',
    );

    // 2. The AREA distinguishes: filled versus outlined. That is the
    //    difference one sees even when both colors look
    //    the same.
    const an = (css.match(/\.alert-badge-on\{([^}]*)\}/) || [])[1] || '';
    const aus = (css.match(/\.alert-badge-off\{([^}]*)\}/) || [])[1] || '';
    assert.ok(an && aus, 'Die beiden Klassen sind nicht gestaltet.');
    assert.match(an, /background:var\(--s200\)/, 'Der scharfe Zustand ist nicht gefüllt.');
    assert.match(aus, /border-color:var\(--bdr\)/, 'Der unscharfe Zustand ist nicht umrandet.');
    assert.match(
      an,
      /font-weight:600/,
      'Auch das Schriftgewicht unterscheidet die beiden nicht — ein Merkmal weniger.',
    );

    // 3. The WORD is a pair, in BOTH languages. Previously it was “scharf"
    //    versus “hat gemeldet" — two statements about different things; whoever
    //    cannot read the color had to infer the contrast.
    const { de, en } = loadTranslations();
    for (const [name, w] of [
      ['DE', de],
      ['EN', en],
    ]) {
      const scharf = String(w['alerts.armed'] || '');
      const unscharf = String(w['alerts.fired'] || '');
      assert.ok(scharf.includes('●'), `${name}: das gefüllte Zeichen fehlt bei „scharf".`);
      assert.ok(unscharf.includes('○'), `${name}: das hohle Zeichen fehlt bei „unscharf".`);
      const a = scharf.replace(/[^\p{L}]/gu, '').toLowerCase();
      const b = unscharf.replace(/[^\p{L}]/gu, '').toLowerCase();
      assert.ok(
        a && b.includes(a),
        `${name}: „${scharf}" und „${unscharf}" sind kein erkennbares Gegensatzpaar. ` +
          'Ohne Farbe ist das der einzige Hinweis darauf, dass der eine Zustand das ' +
          'Gegenteil des anderen ist.',
      );
    }
  });

  await t.test("9. a set of the HOUSEHOLD counts too — Marco's finding from 26.09.", async () => {
    // “The image in the Android app is visible but the entries in the
    // price alerts are not clickable."
    const a = await allAlerts(ich.id);
    const fromKind = a.find(x => x.set_number === '60000-1');
    assert.ok(fromKind, 'Der Alarm auf das Set des Kindes fehlt ganz.');
    assert.equal(
      fromKind.besitzt,
      true,
      'Ein Set des Haushalts gilt als nicht vorhanden — die Zeile wäre nicht ' +
        'anklickbar, obwohl die Detailansicht es öffnet. Genau das war Marcos Befund.',
    );
    assert.equal(
      fromKind.image_local,
      '/uploads/60000-1_thumb.jpg',
      'Auch das Bild kommt nicht aus dem Haushalt, sondern nur aus dem Katalog.',
    );

    // And the flip side of the same extension: the same set is with me AND
    // with the child. Without DISTINCT ON the alert would now appear twice — a
    // bug the narrow first version could not have had.
    assert.equal(
      a.filter(x => x.set_number === '70002-1').length,
      1,
      'Der Alarm steht doppelt: Das Set liegt bei zwei Konten des Haushalts, ' +
        'und die Verbindung vervielfacht die Zeile.',
    );
    // The row WITH a downloaded image must win, not an arbitrary one.
    assert.equal(
      a.find(x => x.set_number === '70002-1').image_local,
      '/uploads/70002-1_thumb.jpg',
      'Von zwei Zeilen hat die ohne Bild gewonnen — dann bliebe die Kachel leer, ' + 'obwohl ein Bild da ist.',
    );
  });

  await t.test('10. deleting works', async () => {
    const vorher = (await allAlerts(ich.id)).length;
    await deleteAlert(ich.id, '99999-9', 'U');
    const a = await allAlerts(ich.id);
    // Against the number measured BEFORE and not against a fixed one: whoever adds
    // an alert above should not fail here. Exactly that just
    // happened when the household case was added.
    assert.equal(a.length, vorher - 1, `Nach dem Löschen stehen ${a.length} Alarme da, vorher waren es ${vorher}.`);
    assert.ok(!a.some(x => x.set_number === '99999-9'), 'Der gelöschte Alarm steht noch in der Übersicht.');
  });
});
