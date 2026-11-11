/**
 * Ein Express-Server für einen Test.
 */
const express = require('express');

/**
 * @param {(pfad: string) => any} _req  buildAndRequire() der Testdatei
 * @param {object} o
 * @param {object} o.sitzung   wird als `req.session` gestellt
 * @param {object} [o.apiNutzer]  wird als `req.apiUser` gestellt; fehlt es,
 *                                bleibt req.apiUser ungesetzt — manche Routen
 *                                unterscheiden genau daran Web und Token.
 * @param {Record<string,string>} o.routen  Pfad → Modul, z. B.
 *                                { '/api/v1': 'routes/api_v1/index.js' }
 * @param {{ after: Function }} [o.t]  Der Testkontext. Ist er da, schliesst
 *                                sich der Server im NACHLAUF — auch wenn eine
 *                                Zusicherung vorher scheitert.
 * @param {boolean} [o.kette]     Die echte Kette vor /api/v1 aus startup/app.ts
 *                                (Anmeldung, Drossel, Schrittschutz, Rumpflimit,
 *                                Idempotenz) statt express.json(); die Sitzung
 *                                bleibt die gestellte.
 */
function testServer(_req, { sitzung = {}, apiNutzer, routen, t, kette = false }) {
  const app = express();
  if (!kette) app.use(express.json());
  app.use((req, _res, next) => {
    req.session = sitzung;
    if (apiNutzer !== undefined) req.apiUser = apiNutzer;
    next();
  });
  if (kette) _req('startup/app.js').apiEingang(app);
  for (const [pfad, modul] of Object.entries(routen)) app.use(pfad, _req(modul));
  const srv = app.listen(0);
  const schliessen = () => new Promise((r) => srv.close(r));
  if (t && typeof t.after === 'function') t.after(schliessen);
  return { app, srv, base: `http://localhost:${srv.address().port}`, schliessen };
}

module.exports = { testServer };
