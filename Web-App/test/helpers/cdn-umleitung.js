/**
 * Vorgeladen (NODE_OPTIONS=--require) in einen echten Server-Prozess: Abrufe an
 * cdn.rebrickable.com gehen an http://127.0.0.1:CDN_UMLEITUNG_PORT, alles andere
 * bleibt. Ohne Netz zum CDN erreicht ein Test so den ganzen Weg über
 * src/infra/abruf.ts, Kopfzeilen eingeschlossen.
 */
const https = require('node:https');
const http = require('node:http');

const port = Number(process.env.CDN_UMLEITUNG_PORT);
if (!port) throw new Error('cdn-umleitung: CDN_UMLEITUNG_PORT fehlt');

for (const art of /** @type {const} */ (['get', 'request'])) {
  const echt = https[art];
  /** @type {any} */ (https)[art] = function umgeleitet(/** @type {any[]} */ ...args) {
    const [adresse, optionen, rueckruf] = args;
    const u = typeof adresse === 'string' ? new URL(adresse) : adresse;
    if (u?.hostname !== 'cdn.rebrickable.com') return echt.apply(https, args);
    // Pool und Adressfamilie gehören zu TLS; der Bildserver des Tests spricht HTTP.
    const { agent: _a, family: _f, ...rest } = optionen || {};
    return http[art](`http://127.0.0.1:${port}${u.pathname}`, rest, rueckruf);
  };
}
