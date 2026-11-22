/**
 * CSP reports (report-uri and report-to) go into the log: shortened, without
 * the query part of the addresses, at most ten per minute per address. The response
 * is always 204 without content; an overlong body is not read.
 *
 * Counter-checks (measured 09.11.2026, each alone):
 *   A  in cspMessageFree() always true → red: “an address reports at most ten per minute”
 *   B  kurz() without cutting off ?/# → red: “report-uri: rule, target and page …”
 *   C  verstoesse() without the branch for report-to → red: “report-to …”
 *   D  the former shared quota (`&& ++insgesamt <= 60`) back → red:
 *      “many senders …” (60 instead of 70 lines)
 *   E  in cspMessageFree() the summary line deleted → red: “what was throttled …”
 *   F  adresse() replaced by the former ohneAnfrageteil() (free text up to
 *      160 characters) → red: “only directives and addresses …”
 *   G  bildansicht() always false → red: “the browser's image view …”
 *   H  in cspMessageFree() the former split(':').slice(0, 4) instead of
 *      throttleAddress() → red: “shortened IPv6 addresses …” (20 instead of 10 free)
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');

const _req = require('./helpers/sources').buildAndRequire();

test('CSP reports', async t => {
  const app = express();
  app.set('trust proxy', true);
  app.use(_req('src/http/cspReport.js').buildCspReportRouter());
  const srv = app.listen(0);
  t.after(() => srv.close());
  const basis = `http://127.0.0.1:${/** @type {import('node:net').AddressInfo} */ (srv.address()).port}/csp-bericht`;
  const log = [];
  const echt = console.warn;
  console.warn = (...a) => {
    log.push(a.join(' '));
  };
  t.after(() => {
    console.warn = echt;
  });
  let n = 0;
  const melde = async (rumpf, typ, adresse = `10.0.0.${++n}`) => {
    log.length = 0;
    const r = await fetch(basis, {
      method: 'POST',
      headers: { 'content-type': typ, 'x-forwarded-for': adresse },
      body: typeof rumpf === 'string' ? rumpf : JSON.stringify(rumpf),
    });
    return { status: r.status, text: await r.text() };
  };

  await t.test('report-uri: rule, target and page, without the query part', async () => {
    const r = await melde(
      {
        'csp-report': {
          'effective-directive': 'require-trusted-types-for',
          'blocked-uri': 'trusted-types-sink',
          'document-uri': 'https://lego.test/reset?token=geheim#x',
          'script-sample': 'Element innerHTML|<b>x',
        },
      },
      'application/csp-report',
    );
    assert.deepEqual(r, { status: 204, text: '' });
    assert.equal(log.length, 1);
    assert.match(
      log[0],
      /\[csp\] require-trusted-types-for blockierte trusted-types-sink auf https:\/\/lego\.test\/reset \(Element innerHTML\|<b>x\)/,
    );
    assert.doesNotMatch(log[0], /geheim/);
  });

  await t.test('report-to: the list of the Reporting API', async () => {
    await melde(
      [
        {
          type: 'csp-violation',
          body: {
            effectiveDirective: 'script-src-elem',
            blockedURL: 'https://fremd.example/x.js',
            documentURL: 'https://lego.test/',
          },
        },
        { type: 'deprecation', body: {} },
      ],
      'application/reports+json',
    );
    assert.deepEqual(log, ['[csp] script-src-elem blockierte https://fremd.example/x.js auf https://lego.test/']);
  });

  await t.test('an address reports at most ten per minute', async () => {
    const bericht = { 'csp-report': { 'effective-directive': 'img-src' } };
    const zeilen = [];
    for (let i = 0; i < 12; i++) {
      await melde(bericht, 'application/csp-report', '10.9.9.9');
      zeilen.push(...log);
    }
    assert.equal(zeilen.length, 10);
  });

  await t.test('an overlong or broken body does not get into the log', async () => {
    assert.equal((await melde('x'.repeat(9000), 'application/csp-report')).status, 413);
    assert.equal((await melde('{kaputt', 'application/csp-report')).status, 204);
    assert.deepEqual(log, []);
  });

  await t.test('many senders do not crowd each other out', async () => {
    const bericht = { 'csp-report': { 'effective-directive': 'img-src' } };
    const zeilen = [];
    for (let i = 0; i < 70; i++) {
      await melde(bericht, 'application/csp-report', `10.7.${Math.floor(i / 200)}.${i % 200}`);
      zeilen.push(...log);
    }
    assert.equal(zeilen.length, 70);
  });

  await t.test('what was throttled stands as one summary line in the log', () => {
    const { cspMessageFree } = _req('src/http/cspReport.js');
    const morgen = Date.now() + 86_400_000;
    // A new window, free of the reports of the subtests before.
    cspMessageFree('10.1.1.2', morgen);
    log.length = 0;
    const frei = Array.from({ length: 12 }, () => cspMessageFree('2001:db8:1:2::7', morgen));
    // The same /64 counts as one sender.
    frei.push(cspMessageFree('2001:db8:1:2::8', morgen));
    assert.equal(frei.filter(Boolean).length, 10);
    assert.equal(cspMessageFree('10.1.1.1', morgen + 60_000), true);
    assert.deepEqual(log, ['[csp] 3 gedrosselt']);
  });

  await t.test('shortened IPv6 addresses from one /64 count as one sender', () => {
    const { cspMessageFree } = _req('src/http/cspReport.js');
    const tag = Date.now() + 2 * 86_400_000;
    cspMessageFree('10.1.1.3', tag);
    const frei = [
      ...Array.from({ length: 10 }, () => cspMessageFree('2001:db8::1', tag)),
      ...Array.from({ length: 10 }, () => cspMessageFree('2001:db8::2', tag)),
    ];
    assert.equal(frei.filter(Boolean).length, 10);
    // Another /64 has its own quota.
    assert.equal(cspMessageFree('2001:db8:0:1::1', tag), true);
    cspMessageFree('10.1.1.3', tag + 60_000);
    log.length = 0;
  });

  await t.test('only directives and addresses get into the log, no free text', async () => {
    await melde(
      {
        'csp-report': {
          'violated-directive': "script-src 'self'",
          'blocked-uri': 'javascript:alert(1)',
          'document-uri': 'nicht eine Adresse [csp] gefälscht',
          'script-sample': 'nur bei Trusted Types',
        },
      },
      'application/csp-report',
    );
    assert.deepEqual(log, ['[csp] script-src blockierte ? auf ?']);
    await melde({ 'csp-report': { 'effective-directive': 'Freitext mit Leerzeichen!' } }, 'application/csp-report');
    await melde({ 'csp-report': { 'effective-directive': 'X'.repeat(30) } }, 'application/csp-report');
    assert.deepEqual(log, [], 'keine Direktive, keine Zeile');
  });

  await t.test("the browser's image view reports nothing, an SVG does", async () => {
    const bericht = seite => ({
      'csp-report': { 'effective-directive': 'style-src-attr', 'blocked-uri': 'inline', 'document-uri': seite },
    });
    await melde(bericht('https://lego.test/images/sets/11515-1.jpg'), 'application/csp-report');
    assert.deepEqual(log, []);
    await melde(bericht('https://lego.test/images/sets/x.svg'), 'application/csp-report');
    assert.deepEqual(log, ['[csp] style-src-attr blockierte inline auf https://lego.test/images/sets/x.svg']);
  });
});
