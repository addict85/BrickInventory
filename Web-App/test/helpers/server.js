/**
 * Ein Server für einen Test: die App aus startup/app.ts (baueApp) mit der Middleware-Kette
 * und den Routern des Betriebs, über die Dienste dieser Testdatei. Gestellt ist nur der
 * Sitzungsspeicher; die Prüfungen der Sitzung danach laufen echt.
 */

/** Was express-session an einer Sitzung anbietet. regenerate und destroy leeren dasselbe
 * Objekt, statt ein neues zu setzen: So liest der Test danach in `sitzung`, was die Route schrieb. */
function alsSitzung(/** @type {Record<string, any>} */ s) {
  const leeren = (/** @type {Function} [fertig] */ fertig) => {
    for (const k of Object.keys(s)) delete s[k];
    fertig?.();
  };
  const methoden = {
    regenerate: leeren,
    destroy: leeren,
    save: (/** @type {Function} [fertig] */ fertig) => fertig?.(),
    reload: (/** @type {Function} [fertig] */ fertig) => fertig?.(),
    touch: () => {},
  };
  for (const [k, f] of Object.entries(methoden))
    if (typeof s[k] !== 'function') Object.defineProperty(s, k, { value: f, configurable: true, writable: true });
  return s;
}

/**
 * @param {(pfad: string) => any} _req  buildAndRequire() der Testdatei
 * @param {object} o
 * @param {object} [o.sitzung]  wird als `req.session` gestellt
 * @param {{ after: Function }} [o.t]  Der Testkontext. Ist er da, schliesst sich der
 *                                Server im NACHLAUF — auch wenn eine Zusicherung vorher scheitert.
 */
function testServer(_req, { sitzung = {}, t } = {}) {
  const { testZugang, testDienste } = require('./sources');
  const gestellt = alsSitzung(sitzung);
  const app = _req('startup/app.js').baueApp({
    pool: testZugang().systemPool,
    konfig: _req('src/infra/konfig.js').konfig(),
    sitzungsGeheimnis: 'test-sitzungsgeheimnis-lang-genug',
    dienste: testDienste(),
    sitzungsSpeicher: (/** @type {any} */ req, /** @type {any} */ _res, /** @type {Function} */ next) => {
      req.session = gestellt;
      next();
    },
  });
  const srv = app.listen(0);
  const schliessen = () => new Promise(r => srv.close(r));
  if (t && typeof t.after === 'function') t.after(schliessen);
  return { app, srv, base: `http://localhost:${srv.address().port}`, schliessen };
}

/**
 * Ersatzweg aus der Zeit vor baueApp: eigene Router hinter express.json(), ohne Sitzungs-
 * und Verwalterprüfungen. Nur für Dateien, die noch nicht auf testServer umgestellt sind;
 * ihre Zahl darf nur sinken (test/ratschen.test.js).
 * @param {(pfad: string) => any} _req
 * @param {{ sitzung?: object, apiNutzer?: object, routen: Record<string, string>, t?: { after: Function } }} o
 */
function routerServer(_req, { sitzung = {}, apiNutzer, routen, t }) {
  const express = require('express');
  const app = express();
  app.use(express.json());
  app.use((/** @type {any} */ req, /** @type {any} */ _res, /** @type {Function} */ next) => {
    req.session = sitzung;
    if (apiNutzer !== undefined) req.apiUser = apiNutzer;
    next();
  });
  app.use(_req('src/http/kontoMerken.js').merkeAnfrage);
  for (const [pfad, modul] of Object.entries(routen)) app.use(pfad, require('./sources').routerAus(_req, modul));
  const srv = app.listen(0);
  const schliessen = () => new Promise(r => srv.close(r));
  if (t && typeof t.after === 'function') t.after(schliessen);
  return { app, srv, base: `http://localhost:${srv.address().port}`, schliessen };
}

module.exports = { testServer, routerServer };
