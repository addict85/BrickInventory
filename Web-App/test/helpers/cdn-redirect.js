/**
 * Preloaded (NODE_OPTIONS=--require) into a real server process: fetches to
 * cdn.rebrickable.com go to http://127.0.0.1:CDN_UMLEITUNG_PORT, everything else
 * stays. Without network to the CDN a test thus reaches the whole path via
 * src/infra/fetch.ts, headers included.
 */
const https = require('node:https');
const http = require('node:http');

const port = Number(process.env.CDN_UMLEITUNG_PORT);
if (!port) throw new Error('cdn-umleitung: CDN_UMLEITUNG_PORT fehlt');

for (const art of /** @type {const} */ (['get', 'request'])) {
  const echt = https[art];
  /** @type {any} */ (https)[art] = function umgeleitet(/** @type {any[]} */ ...args) {
    const [adresse, optionen, callback] = args;
    const u = typeof adresse === 'string' ? new URL(adresse) : adresse;
    if (u?.hostname !== 'cdn.rebrickable.com') return echt.apply(https, args);
    // Pool and address family belong to TLS; the test's image server speaks HTTP.
    const { agent: _a, family: _f, ...rest } = optionen || {};
    return http[art](`http://127.0.0.1:${port}${u.pathname}`, rest, callback);
  };
}
