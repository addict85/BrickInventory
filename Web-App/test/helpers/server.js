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
 */
function testServer(_req, { sitzung = {}, apiNutzer, routen, t }) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.session = sitzung;
    if (apiNutzer !== undefined) req.apiUser = apiNutzer;
    next();
  });
  for (const [pfad, modul] of Object.entries(routen)) app.use(pfad, _req(modul));
  const srv = app.listen(0);
  const schliessen = () => new Promise((r) => srv.close(r));
  if (t && typeof t.after === 'function') t.after(schliessen);
  return { app, srv, base: `http://localhost:${srv.address().port}`, schliessen };
}

module.exports = { testServer };
