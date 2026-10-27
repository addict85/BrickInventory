/**
 * Ohne SMTP zeigt die Konsole den Link einer Mail — in Produktion ohne Token.
 * Die Konsole landet in app_logs; ein Reset-Link darin wäre für jeden
 * Verwalter 48 Stunden lang ein Zugang zu fremden Konten.
 *
 * Gegenproben (am 27.10. gemessen):
 *   A  die Ersetzung in linkFuerKonsole entfernt → rot: „in Produktion ohne Token"
 *   B  wieder nur bei NODE_ENV=production maskiert → rot: „ohne NODE_ENV ohne Token"
 */
const test   = require('node:test');
const assert = require('node:assert/strict');

const _req = require('./helpers/sources').buildAndRequire();
const { linkFuerKonsole } = _req('utils/mailer.js');

const TEXT = 'Hallo,\n\nhier zurücksetzen:\nhttps://lego.example.org/reset?token=abcdef0123456789\n\nGruss';

test('in Produktion ohne Token', () => {
  const link = linkFuerKonsole(TEXT, 'production');
  assert.equal(link, 'https://lego.example.org/reset?token=…');
  assert.ok(!link.includes('abcdef'), link);
  assert.equal(linkFuerKonsole('https://x.example/verify?a=1&token=geheim#oben', 'production'),
    'https://x.example/verify?a=1&token=…#oben');
});

test('in der Entwicklung vollständig — dort ist die Konsole der Postausgang', () => {
  assert.equal(linkFuerKonsole(TEXT, 'development'), 'https://lego.example.org/reset?token=abcdef0123456789');
});

test('ohne NODE_ENV ohne Token — wer es vergisst, ist nicht in der Entwicklung', () => {
  const alt = process.env.NODE_ENV;
  delete process.env.NODE_ENV;
  try { assert.equal(linkFuerKonsole(TEXT), 'https://lego.example.org/reset?token=…'); }
  finally { if (alt !== undefined) process.env.NODE_ENV = alt; }
  assert.equal(linkFuerKonsole(TEXT, 'staging'), 'https://lego.example.org/reset?token=…');
  assert.equal(linkFuerKonsole(TEXT, 'test'), 'https://lego.example.org/reset?token=abcdef0123456789');
});

test('ohne Link nichts', () => {
  assert.equal(linkFuerKonsole('nur Text', 'production'), null);
  assert.equal(linkFuerKonsole(undefined, 'production'), null);
});
