/**
 * Ein Express-Server für einen Test.
 *
 * ── Warum es diesen Helfer gibt ─────────────────────────────────────────────
 *
 * Achtunddreissig Testdateien bauen sich einen Server, und zwanzig davon taten
 * es zeichengleich:
 *
 *     const app = express();
 *     app.use(express.json());
 *     app.use((req, _res, next) => {
 *       req.session = { userId: uid };
 *       req.apiUser = { user_id: uid, is_admin: 0 };
 *       next();
 *     });
 *     app.use('/api/v1', _req('routes/api_v1/index.js'));
 *     const srv = app.listen(0);
 *     const base = `http://localhost:${srv.address().port}`;
 *
 * Das ist Gerüst, keine Regel — zwei Fassungen davon können nicht
 * auseinanderlaufen und dabei ein falsches Ergebnis erzeugen. Deshalb ist es
 * auch nicht dringend gewesen. Der Gewinn liegt woanders:
 *
 *  1. Das ABRÄUMEN steht an einer Stelle. Etliche Dateien schlossen den Server
 *     gar nicht; wer es tat, tat es am Ende des Rumpfes — und damit NICHT
 *     mehr, sobald eine Zusicherung davor scheitert. Aus einem roten Test wird
 *     dann ein hängender, und die Meldung sieht niemand. Genau das ist in
 *     dieser Reihe zweimal passiert (schema-start-ohne-fehler,
 *     background-jobs-start), beide Male beim Gegenprobieren.
 *
 *  2. Wer einen neuen Testserver braucht, findet hier die Form, statt sie aus
 *     einer beliebigen Nachbardatei zu kopieren.
 *
 * Die achtzehn abweichenden Dateien bleiben, wie sie sind: Sie hängen zwei
 * Server nebeneinander, schieben eigene Middleware davor oder stellen die
 * Sitzung je Aufruf um. Sie hier hineinzuzwingen hiesse, dem Helfer für jeden
 * Sonderfall einen Schalter zu geben — dann liest sich der Aufruf schlechter
 * als die fünf Zeilen, die er ersetzt.
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
