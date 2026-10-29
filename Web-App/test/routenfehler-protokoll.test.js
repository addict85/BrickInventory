'use strict';
/**
 * Die Fehlerzeile nennt, WELCHE Anfrage gescheitert ist.
 *
 * ── Marcos Befund ───────────────────────────────────────────────────────────
 * Im Serverprotokoll stand:
 *
 *     [route-error] 404: Error: Nicht gefunden
 *         at fehlerWerfen (…/fehlerTexte.js:243:13)
 *         at …/routes/api_v1/acquisitions.js:93:55
 *
 * Der Stack sagt, WELCHE ZEILE geworfen hat. Er sagt nicht, welche Anfrage
 * dort ankam — und genau das entschied hier alles: acquisitions.js bedient
 * Teile und Minifiguren aus EINER gemeinsamen Fabrik, und die gesuchte
 * Kennung steht im Pfad. Ohne sie liess sich „die Zeile war schon geloescht"
 * nicht von „die Oberflaeche schickt die falsche Nummer" trennen.
 *
 * ── Was hier geprueft wird ──────────────────────────────────────────────────
 * Die Funktion wird AUSGEFUEHRT, nicht gelesen: console.error wird
 * abgefangen, handleRouteError mit einer nachgebauten Anfrage gerufen und die
 * Zeile untersucht. Ein Quelltexttest haette hier wenig Wert — die Frage ist
 * nicht, ob die Zeichenkette zusammengebaut wird, sondern was am Ende
 * dasteht.
 *
 * Vier Zusicherungen:
 *   1. Methode und Pfad stehen drin.
 *   2. Der Fragezeichen-Teil NICHT — ein Protokoll ist der falsche Ort, um im
 *      Einzelfall zu entscheiden, was in einer Abfrage stehen darf.
 *   3. Ohne `req` bleibt die Zeile wie bisher. Sonst waere aus einer
 *      Ergaenzung ein „undefined undefined" in jeder Zeile geworden, die
 *      keine Anfrage kennt.
 *   4. Ein 4xx ist eine Warnung ohne Stack, ein 5xx ein Fehler mit Stack —
 *      sonst füllt jede falsche Eingabe app_logs mit Fehlern.
 *
 * Gegenprobe (29.10.2026): in handleRouteError wieder jede Stufe über
 * console.error mit `e?.stack` → rot: „ein 4xx ist eine Warnung ohne Stack“
 * (Stufe error, Stack in der Zeile) und „die Fehlerzeile nennt Methode und Pfad“.
 *
 * Ausfuehren: npm test
 */
const test = require('node:test');
const assert = require('node:assert/strict');

const { buildAndRequire } = require('./helpers/sources');
const _req = buildAndRequire();
const { handleRouteError } = _req('utils/httpError.js');

/** Ruft handleRouteError; liefert die eine Zeile samt Stufe (error/warn). */
function protokolliereMitStufe(fehler, req) {
  const zeilen = [];
  const echt = { error: console.error, warn: console.warn };
  console.error = (...teile) => zeilen.push({ stufe: 'error', zeile: teile.map(String).join(' ') });
  console.warn = (...teile) => zeilen.push({ stufe: 'warn', zeile: teile.map(String).join(' ') });
  // Eine Antwort, die nur so viel kann, wie handleRouteError braucht.
  const res = { headersSent: false, status() { return this; }, json() { return this; } };
  try { handleRouteError(res, fehler, undefined, req); }
  finally { Object.assign(console, echt); }
  assert.equal(zeilen.length, 1, 'Es soll genau eine Zeile geschrieben werden');
  return zeilen[0];
}
const protokolliere = (fehler, req) => protokolliereMitStufe(fehler, req).zeile;

test('die Fehlerzeile nennt Methode und Pfad', () => {
  const e = Object.assign(new Error('Nicht gefunden'), { status: 404, code: 'nicht_gefunden' });
  const zeile = protokolliere(e, {
    method: 'PUT',
    originalUrl: '/api/v1/parts/3001/5/acquisitions/42',
  });
  assert.match(zeile, /\[route-warnung\] PUT \/api\/v1\/parts\/3001\/5\/acquisitions\/42 404:/,
    `Ohne Methode und Pfad ist die Zeile nicht zuzuordnen — dastand: ${zeile}`);
});

test('der Fragezeichen-Teil bleibt draussen', () => {
  const e = Object.assign(new Error('Nicht gefunden'), { status: 404 });
  const zeile = protokolliere(e, {
    method: 'GET',
    originalUrl: '/api/v1/sets?accounts=alle&geheim=abc',
  });
  assert.ok(zeile.includes('GET /api/v1/sets '), `Pfad fehlt: ${zeile}`);
  assert.ok(!zeile.includes('geheim'),
    'Die Abfrage steht mit im Protokoll — was dort stehen darf, ist nicht Sache ' +
    `des Protokolls: ${zeile}`);
  assert.ok(!zeile.includes('accounts'), `Die Abfrage steht mit im Protokoll: ${zeile}`);
});

test('ohne Anfrage bleibt die Zeile wie bisher', () => {
  // Es gibt Aufrufer ausserhalb einer Route (Hintergrundarbeit, Tests). Aus
  // der Ergaenzung darf dort kein „undefined undefined" werden.
  const zeile = protokolliere(new Error('kaputt'), undefined);
  assert.match(zeile, /\[route-error\] 500:/, `Unerwartete Form: ${zeile}`);
  assert.ok(!zeile.includes('undefined'), `„undefined\" in der Zeile: ${zeile}`);
});

test('ein 4xx ist eine Warnung ohne Stack, ein 5xx ein Fehler mit Stack', () => {
  const nicht = protokolliereMitStufe(Object.assign(new Error('Nicht gefunden'), { status: 404 }),
    { method: 'GET', originalUrl: '/api/v1/sets/1-1' });
  assert.equal(nicht.stufe, 'warn');
  assert.match(nicht.zeile, /Nicht gefunden/);
  assert.ok(!/\n\s+at /.test(nicht.zeile), `Stack in einer 4xx-Zeile: ${nicht.zeile}`);

  const kaputt = protokolliereMitStufe(new Error('Verbindung weg'), { method: 'GET', originalUrl: '/api/v1/sets' });
  assert.equal(kaputt.stufe, 'error');
  assert.match(kaputt.zeile, /\n\s+at /, 'ein 5xx trägt seinen Stack');
});
