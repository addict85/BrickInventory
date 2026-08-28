/**
 * Die Hintergrundläufe starten wirklich.
 *
 * ── Marcos Befund (Nachtrag 139) ────────────────────────────────────────────
 * „Die Jobs scheinen nicht zu laufen in der webapp."
 *
 * Beim Auslagern der Startstaffel nach startup/backgroundJobs.ts (Nachtrag 134)
 * wanderten zehn `require('./jobs/…')` WORTGLEICH mit. Aus startup/ gesehen
 * gibt es './jobs' nicht — jeder Aufruf warf sofort.
 *
 * Und weil sie in `setTimeout(...)` und `.catch(() => {})` stecken, blieb es
 * STILL: kein Job lief an, kein Fehler im Log. Genau die Bauart, die in
 * Nachtrag 131 schon einmal zugeschlagen hat.
 *
 * Diese Prüfung lädt das Modul und ruft es auf — mit abgefangenen Jobs. Damit
 * ist belegt, dass jeder Start WIRKLICH ankommt, nicht nur, dass sein Name
 * irgendwo im Quelltext steht.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';
process.env.WEB_WORKERS = '1';

const gestartet = [];
const echtesRequire = Module.prototype.require;

// Die Jobs abfangen, BEVOR das Startmodul geladen wird — es importiert sie am
// Dateikopf, also zählt nur, was vor dem Laden gesetzt ist.
Module.prototype.require = function (name) {
  const m = echtesRequire.apply(this, arguments);
  if (typeof name !== 'string') return m;
  const merke = (job, fn) => (...args) => { gestartet.push(job); return undefined; };
  if (/jobs[/\\]priceJob(\.js)?$/.test(name))
    return new Proxy(m, { get: (t, k) => k === 'start' ? merke('priceJob') : t[k] });
  if (/jobs[/\\]instructionQueue(\.js)?$/.test(name))
    return new Proxy(m, { get: (t, k) =>
      k === 'start' ? merke('instructionQueue') :
      k === 'processNext' ? () => {} :
      k === 'enqueue' ? async () => {} : t[k] });
  if (/jobs[/\\]imageQueue(\.js)?$/.test(name))
    return new Proxy(m, { get: (t, k) => k === 'start' ? merke('imageQueue') : t[k] });
  if (/routes[/\\]imgProxy(\.js)?$/.test(name))
    return new Proxy(m, { get: (t, k) => k === 'startImgCacheCleanup' ? merke('imgCacheCleanup') : t[k] });
  if (/api_v1[/\\]pdf(\.js)?$/.test(name))
    return new Proxy(m, { get: (t, k) => k === 'startPdfJobCleanup' ? merke('pdfJobCleanup') : t[k] });
  return m;
};

const _req = require('./helpers/sources').buildAndRequire();

test('jeder Hintergrundlauf wird tatsächlich angestossen', async (t) => {
  const db = _req('db/database.js');
  try { await db.initSchemaOnce(); }
  catch (e) {
    if (process.env.REQUIRE_DB === '1') throw e;
    t.skip('Test-DB nicht erreichbar'); return;
  }

  gestartet.length = 0;
  await _req('startup/backgroundJobs.js').starteHintergrundlaeufe();

  // Die fünf, die SOFORT starten (die übrigen hängen an setTimeout-Staffeln
  // von 10 bis 45 Sekunden und werden hier nicht abgewartet).
  for (const job of ['imgCacheCleanup', 'pdfJobCleanup', 'priceJob',
                     'instructionQueue', 'imageQueue']) {
    assert.ok(gestartet.includes(job),
      `${job} wurde nicht angestossen. Angekommen sind: ${gestartet.join(', ') || '(nichts)'}. ` +
      'Genau so sah Marcos Ausfall aus — die Aufrufe warfen in einem catch, ' +
      'das nichts meldet.');
  }

  await db.pool.end().catch(() => {});
  Module.prototype.require = echtesRequire;
});
