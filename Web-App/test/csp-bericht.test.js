/**
 * CSP-Berichte (report-uri und report-to) kommen ins Protokoll: gekürzt, ohne
 * Anfrageteil der Adressen, je Adresse höchstens zehn je Minute. Die Antwort
 * ist immer 204 ohne Inhalt; ein überlanger Rumpf wird nicht gelesen.
 *
 * Gegenproben (09.11.2026 gemessen, je einzeln):
 *   A  in cspMeldungFrei() immer true → rot: „eine Adresse meldet höchstens zehn je Minute“
 *   B  kurz() ohne das Abschneiden von ?/# → rot: „report-uri: Regel, Ziel und Seite …“
 *   C  verstoesse() ohne den Zweig für report-to → rot: „report-to …“
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');

const _req = require('./helpers/sources').buildAndRequire();

test('CSP-Berichte', async t => {
  const app = express();
  app.set('trust proxy', true);
  app.use(_req('src/http/cspBericht.js'));
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

  await t.test('report-uri: Regel, Ziel und Seite, ohne Anfrageteil', async () => {
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

  await t.test('report-to: die Liste der Reporting-API', async () => {
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

  await t.test('eine Adresse meldet höchstens zehn je Minute', async () => {
    const bericht = { 'csp-report': { 'effective-directive': 'img-src' } };
    const zeilen = [];
    for (let i = 0; i < 12; i++) {
      await melde(bericht, 'application/csp-report', '10.9.9.9');
      zeilen.push(...log);
    }
    assert.equal(zeilen.length, 10);
  });

  await t.test('ein überlanger oder kaputter Rumpf kommt nicht ins Protokoll', async () => {
    assert.equal((await melde('x'.repeat(9000), 'application/csp-report')).status, 413);
    assert.equal((await melde('{kaputt', 'application/csp-report')).status, 204);
    assert.deepEqual(log, []);
  });
});
