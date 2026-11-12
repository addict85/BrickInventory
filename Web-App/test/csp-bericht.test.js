/**
 * CSP-Berichte (report-uri und report-to) kommen ins Protokoll: gekürzt, ohne
 * Anfrageteil der Adressen, je Adresse höchstens zehn je Minute. Die Antwort
 * ist immer 204 ohne Inhalt; ein überlanger Rumpf wird nicht gelesen.
 *
 * Gegenproben (09.11.2026 gemessen, je einzeln):
 *   A  in cspMeldungFrei() immer true → rot: „eine Adresse meldet höchstens zehn je Minute“
 *   B  kurz() ohne das Abschneiden von ?/# → rot: „report-uri: Regel, Ziel und Seite …“
 *   C  verstoesse() ohne den Zweig für report-to → rot: „report-to …“
 *   D  die frühere gemeinsame Quote (`&& ++insgesamt <= 60`) zurück → rot:
 *      „viele Absender …“ (60 statt 70 Zeilen)
 *   E  in cspMeldungFrei() die Sammelzeile gestrichen → rot: „was gedrosselt …“
 *   F  adresse() durch das frühere ohneAnfrageteil() ersetzt (Freitext bis
 *      160 Zeichen) → rot: „nur Direktiven und Adressen …“
 *   G  bildansicht() immer false → rot: „die Bildansicht des Browsers …“
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

  await t.test('viele Absender verdrängen einander nicht', async () => {
    const bericht = { 'csp-report': { 'effective-directive': 'img-src' } };
    const zeilen = [];
    for (let i = 0; i < 70; i++) {
      await melde(bericht, 'application/csp-report', `10.7.${Math.floor(i / 200)}.${i % 200}`);
      zeilen.push(...log);
    }
    assert.equal(zeilen.length, 70);
  });

  await t.test('was gedrosselt wurde, steht als eine Sammelzeile im Protokoll', () => {
    const { cspMeldungFrei } = _req('src/http/cspBericht.js');
    const morgen = Date.now() + 86_400_000;
    // Ein neues Fenster, frei von den Meldungen der Teiltests davor.
    cspMeldungFrei('10.1.1.2', morgen);
    log.length = 0;
    const frei = Array.from({ length: 12 }, () => cspMeldungFrei('2001:db8:1:2::7', morgen));
    // Dasselbe /64 zählt als ein Absender.
    frei.push(cspMeldungFrei('2001:db8:1:2::8', morgen));
    assert.equal(frei.filter(Boolean).length, 10);
    assert.equal(cspMeldungFrei('10.1.1.1', morgen + 60_000), true);
    assert.deepEqual(log, ['[csp] 3 gedrosselt']);
  });

  await t.test('nur Direktiven und Adressen kommen ins Protokoll, kein Freitext', async () => {
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

  await t.test('die Bildansicht des Browsers meldet nichts, ein SVG schon', async () => {
    const bericht = seite => ({
      'csp-report': { 'effective-directive': 'style-src-attr', 'blocked-uri': 'inline', 'document-uri': seite },
    });
    await melde(bericht('https://lego.test/images/sets/11515-1.jpg'), 'application/csp-report');
    assert.deepEqual(log, []);
    await melde(bericht('https://lego.test/images/sets/x.svg'), 'application/csp-report');
    assert.deepEqual(log, ['[csp] style-src-attr blockierte inline auf https://lego.test/images/sets/x.svg']);
  });
});
