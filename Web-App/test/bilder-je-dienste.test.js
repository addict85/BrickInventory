/**
 * Die Bilder halten ihren Zustand (Fehlanzeigen, Bildbedarf, Blickfeld) in den Fächern
 * ihres Satzes Dienste, nicht im Modul: Zwei Sätze in einem Prozess (Tests, Werkzeuge)
 * spiegeln einander nichts vor. Es wird nichts abgefragt; der Zugang bleibt ungenutzt.
 *
 * Gegenproben (am 14.11.2026 gemessen, je einzeln):
 *   A  in src/bilder/imageMisses.ts `stand` wieder als Modulkonstante (ein Satz Maps
 *      für alle) → rot: „eine Fehlanzeige gilt nur ihrem Satz Dienste“
 *   B  in src/bilder/bildbedarf.ts bildEinmalVormerken() mit einem modulweiten
 *      Zwischenspeicher → rot: „jeder Satz merkt sich selbst, was er vorgemerkt hat“
 */
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';
const S = require('./helpers/sources');
const _req = S.buildAndRequire();
const { baueDienste } = _req('startup/verdrahtung.js');
const { OHNE_NACHARBEIT } = _req('src/auftraege/nacharbeit.js');

/** Ein Satz Dienste, dessen Nacharbeit mitschreibt, was vorgemerkt wurde. */
function satz() {
  const vorgemerkt = [];
  const nacharbeit = { ...OHNE_NACHARBEIT, bildVormerken: (url, sn) => vorgemerkt.push(`${sn} ${url}`) };
  return { d: baueDienste(S.testZugang(), { nacharbeit }), vorgemerkt };
}

test('eine Fehlanzeige gilt nur ihrem Satz Dienste', () => {
  const a = satz().d,
    b = satz().d;
  a.bilder.merkeFehlend('set:99901-1', 'HTTP 404 vom CDN');
  assert.equal(a.bilder.istBekanntFehlend('set:99901-1'), true);
  assert.equal(b.bilder.istBekanntFehlend('set:99901-1'), false);
});

test('jeder Satz merkt sich selbst, was er vorgemerkt hat', () => {
  const a = satz(),
    b = satz();
  const url = 'https://cdn.rebrickable.com/media/sets/99902-1.jpg';
  a.d.bilder.bildEinmalVormerken(url, '99902-1');
  a.d.bilder.bildEinmalVormerken(url, '99902-1');
  b.d.bilder.bildEinmalVormerken(url, '99902-1');
  assert.deepEqual(a.vorgemerkt, [`99902-1 ${url}`], 'innerhalb der Frist nur einmal');
  assert.deepEqual(b.vorgemerkt, [`99902-1 ${url}`], 'der zweite Satz kennt die Vormerkung des ersten nicht');
});
