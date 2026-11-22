/**
 * The “view set" button in the price alert mail — and what happens if it
 * cannot be built.
 *
 * ── Counter-checks (performed, result in the commit) ────────────────────────
 *   a) set the button unconditionally (even without base) → step 2 red.
 *   b) removed the hint                                    → step 2 red.
 *   c) output the hint on EVERY call                       → step 3 red.
 */
const test = require('node:test');
const { environment } = require('./helpers/sources');
const assert = require('node:assert/strict');

const _req = require('./helpers/sources').buildAndRequire();

const DATEN = {
  username: 'marco',
  lang: 'de',
  setNumber: '10179-1',
  setName: 'Millennium Falcon',
  condition: 'N',
  direction: 'unter',
  threshold: 200,
  price: 180,
  currency: 'CHF',
};

/** Collect console.warn instead of littering the test run. */
async function warningsOf(fn) {
  const echt = console.warn;
  const collected = [];
  console.warn = (...a) => collected.push(a.join(' '));
  try {
    await fn();
  } finally {
    console.warn = echt;
  }
  return collected;
}

test('price alert mail: the button and its absence', async t => {
  // Load fresh so that the “once per process" flag belongs to this check
  // and not to an earlier test.
  const mailer = _req('src/mail/mailer.js');
  const vorher = process.env.APP_BASE_URL;

  await t.test('1. with APP_BASE_URL the mail carries the link', async () => {
    environment({ APP_BASE_URL: 'https://lego.example.test/' });
    const m = await mailer.buildAlertMail(DATEN);
    // The trailing slash of the variable must not double.
    assert.match(
      m.html,
      /https:\/\/lego\.example\.test\/\?set=10179-1/,
      `Der Link fehlt oder ist falsch zusammengesetzt:\n${m.html.slice(0, 400)}`,
    );
    assert.match(m.html, /Set ansehen/, 'Der Knopf trägt keine Beschriftung.');
    assert.match(m.html, /class="btn-link"/, 'Der Link steht nicht als Knopf da.');
  });

  await t.test('2. without APP_BASE_URL no guessed link — and a hint', async () => {
    // Two statements in ONE step, and that is not merging out of
    // convenience: the hint fires exactly ONCE per process, so
    // the first call without a base URL must answer both questions. A second
    // step before it would have used up the flag — exactly that happened with the first …
    environment({ APP_BASE_URL: undefined });
    let m;
    const collected = await warningsOf(async () => {
      m = await mailer.buildAlertMail(DATEN);
    });

    assert.ok(!/\?set=/.test(m.html), 'Ohne bekannte Adresse steht trotzdem ein Link in der Mail.');
    assert.ok(!/Set ansehen/.test(m.html), 'Der Knopf ist da, kann aber nirgends hinfuehren.');
    // The rest of the mail stays complete — only the button is missing.
    assert.match(m.html, /Marktpreis/, 'Ohne Basis-URL fehlt auf einmal die halbe Mail.');
    assert.match(m.subject, /10179-1/);

    // Exactly that was missing: Marco saw a missing button, the operator saw
    // nothing. getBaseUrl() in routes/auth.ts closed the same gap long
    // ago — with the same means.
    assert.ok(
      collected.some(z => z.includes('APP_BASE_URL')),
      `Kein Hinweis im Protokoll. Gesammelt: ${JSON.stringify(collected)}`,
    );
  });

  await t.test('3. but only ONCE, not per alert', async () => {
    // The price run builds the mail for EVERY triggered alert. With twenty
    // alerts, twenty times the same line would look like a storm instead of a
    // hint. Step 2 has already triggered the hint — none may come
    // here anymore.
    environment({ APP_BASE_URL: undefined });
    const collected = await warningsOf(async () => {
      for (let i = 0; i < 3; i++) await mailer.buildAlertMail(DATEN);
    });
    const treffer = collected.filter(z => z.includes('APP_BASE_URL')).length;
    assert.equal(treffer, 0, `Der Hinweis wiederholt sich (${treffer}-mal bei drei Mails).`);
  });

  // Marco's finding from 25.09.: the tiles bumped into each other
  //
  // Counter-checks (performed, each red, green again afterwards):
  //   a) back to 50 / 12px / 50  -> red: “Found: 2" (the spacing is then
  //                                 in pixels and drops out of the count)
  //   b) unequal tiles (44/12/40) -> red: “the widths add up to 96 %"
  await t.test('4. the two tiles leave room in the middle', async () => {
    environment({ APP_BASE_URL: 'https://lego.example.org' });
    const m = await mailer.buildAlertMail(DATEN);
    const breiten = [...m.html.matchAll(/<td width="(\d+)%"/g)].map(t => Number(t[1]));
    assert.equal(
      breiten.length,
      3,
      `Erwartet: zwei Kacheln und ein Abstand, alle in Prozent. Gefunden: ${breiten.length}.`,
    );
    const [links, mitte, rechts] = breiten;
    assert.equal(
      links + mitte + rechts,
      100,
      `Die Breiten ergeben ${links + mitte + rechts} % — der Klient muss dann etwas stauchen.`,
    );
    assert.equal(links, rechts, 'Die beiden Kacheln sind unterschiedlich breit.');
    assert.ok(mitte > 0, 'In der Mitte steht kein Abstand.');
  });

  if (vorher === undefined) environment({ APP_BASE_URL: undefined });
  else environment({ APP_BASE_URL: vorher });
});
