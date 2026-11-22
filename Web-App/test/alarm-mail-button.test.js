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

const DATA = {
  username: 'marco',
  lang: 'de',
  setNumber: '10179-1',
  setName: 'Millennium Falcon',
  condition: 'N',
  direction: 'below',
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
    const m = await mailer.buildAlertMail(DATA);
    // The trailing slash of the variable must not double.
    assert.match(
      m.html,
      /https:\/\/lego\.example\.test\/\?set=10179-1/,
      `The link is missing or assembled wrongly:\n${m.html.slice(0, 400)}`,
    );
    assert.match(m.html, /Set ansehen/, 'The button carries no label.');
    assert.match(m.html, /class="btn-link"/, 'The link is not shown as a button.');
  });

  await t.test('2. without APP_BASE_URL no guessed link — and a hint', async () => {
    // Two statements in ONE step, and that is not merging out of
    // convenience: the hint fires exactly ONCE per process, so
    // the first call without a base URL must answer both questions. A second
    // step before it would have used up the flag — exactly that happened with the first …
    environment({ APP_BASE_URL: undefined });
    let m;
    const collected = await warningsOf(async () => {
      m = await mailer.buildAlertMail(DATA);
    });

    assert.ok(!/\?set=/.test(m.html), 'Without a known address there is still a link in the mail.');
    assert.ok(!/Set ansehen/.test(m.html), 'The button is there but cannot lead anywhere.');
    // The rest of the mail stays complete — only the button is missing.
    assert.match(m.html, /Marktpreis/, 'Without a base URL suddenly half of the mail is missing.');
    assert.match(m.subject, /10179-1/);

    // Exactly that was missing: Marco saw a missing button, the operator saw
    // nothing. getBaseUrl() in routes/auth.ts closed the same gap long
    // ago — with the same means.
    assert.ok(
      collected.some(z => z.includes('APP_BASE_URL')),
      `No hint in the log. Collected: ${JSON.stringify(collected)}`,
    );
  });

  await t.test('3. but only ONCE, not per alert', async () => {
    // The price run builds the mail for EVERY triggered alert. With twenty
    // alerts, twenty times the same line would look like a storm instead of a
    // hint. Step 2 has already triggered the hint — none may come
    // here anymore.
    environment({ APP_BASE_URL: undefined });
    const collected = await warningsOf(async () => {
      for (let i = 0; i < 3; i++) await mailer.buildAlertMail(DATA);
    });
    const treffer = collected.filter(z => z.includes('APP_BASE_URL')).length;
    assert.equal(treffer, 0, `The hint repeats (${treffer} times for three mails).`);
  });

  // Marco's finding from 25.09.: the tiles bumped into each other
  //
  // Counter-checks (performed, each red, green again afterwards):
  //   a) back to 50 / 12px / 50  -> red: “Found: 2" (the spacing is then
  //                                 in pixels and drops out of the count)
  //   b) unequal tiles (44/12/40) -> red: “the widths add up to 96 %"
  await t.test('4. the two tiles leave room in the middle', async () => {
    environment({ APP_BASE_URL: 'https://lego.example.org' });
    const m = await mailer.buildAlertMail(DATA);
    const breiten = [...m.html.matchAll(/<td width="(\d+)%"/g)].map(t => Number(t[1]));
    assert.equal(breiten.length, 3, `Expected: two tiles and a gap, all in percent. Found: ${breiten.length}.`);
    const [links, center, rechts] = breiten;
    assert.equal(
      links + center + rechts,
      100,
      `The widths add up to ${links + center + rechts} % — the client then has to squeeze something.`,
    );
    assert.equal(links, rechts, 'The two tiles have different widths.');
    assert.ok(center > 0, 'There is no gap in the middle.');
  });

  if (vorher === undefined) environment({ APP_BASE_URL: undefined });
  else environment({ APP_BASE_URL: vorher });
});
