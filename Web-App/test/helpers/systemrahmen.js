'use strict';
/**
 * Vor `require('node:test')` geladen: Was der Test selbst aufruft (Testdaten über
 * Dienste, Dienste ohne Konto), läuft im Systemrahmen, also
 * über die Systemrolle am Zeilenschutz vorbei. HTTP-Anfragen verlassen ihn
 * (asRequest) und laufen wie im Betrieb. Die Zahl dieser Dateien darf nur sinken
 * (test/roles-separation-db.test.js); eine umgestellte Datei setzt das Konto selbst (asRequest).
 */
const Module = /** @type {any} */ (require('node:module'));
const path = require('node:path');

const echt = require('node:test');
// Erst beim Aufruf: Zum Ladezeitpunkt ist dist/ womöglich noch nicht gebaut.
const inSystemContext = (grund, f) =>
  require(path.join(__dirname, '..', '..', 'dist', 'src', 'infra', 'accountContext.js')).inSystemContext(grund, f);

// Die Stelligkeit bleibt: An ihr erkennt node:test einen Test mit done-Rückruf.
const inFrame = f =>
  typeof f === 'function'
    ? Object.defineProperty(
        function (...a) {
          return inSystemContext('Testdaten', () => f.apply(this, a));
        },
        'length',
        { value: f.length },
      )
    : f;
const huelle = f => {
  const h = function (...a) {
    return f.apply(this, a.map(inFrame));
  };
  for (const k of ['only', 'skip', 'todo'])
    if (typeof f[k] === 'function') h[k] = (...a) => f[k].apply(f, a.map(inFrame));
  return h;
};

const test = /** @type {any} */ (huelle(echt));
for (const k of Object.keys(echt))
  if (['it', 'describe', 'suite', 'before', 'after', 'beforeEach', 'afterEach'].includes(k)) test[k] = huelle(echt[k]);
  else if (k === 'test') test.test = test;
  else if (!(k in test)) Object.defineProperty(test, k, { get: () => echt[k], enumerable: true });

// TEST_OHNE_SYSTEMRAHMEN=1 zeigt, welche Dateien schon ohne den Rahmen grün sind.
const laden = Module._load;
if (process.env.TEST_OHNE_SYSTEMRAHMEN !== '1')
  Module._load = function (anfrage, ...rest) {
    return anfrage === 'node:test' || anfrage === 'test' ? test : laden.call(this, anfrage, ...rest);
  };
