/**
 * The balance query with its real fetch path (src/infra/fetch.ts) against
 * a TLS server that poses as www.lego.com: an agent redirects every
 * connection to 127.0.0.1, nothing goes out. Cookies, token and POST body
 * arrive; a redirect to a foreign host and an oversized response
 * become an error instead of passing on card number and PIN.
 *
 * Counter-checks (measured on 02.11.2026):
 *   A  fetchBalance again with globalThis.fetch → red: all three (the
 *      test server sees no request, fetch does not take the agent)
 *   B  in legoFetch the host list extended by example.org → red: “a
 *      redirect to a foreign host …” (example.org is requested)
 *   C  in abruf.ts `req.end(o.rumpf)` without a body → red: “cookies, token and
 *      body …” (the query arrives without a card number)
 *   D  maxBytes of the POST response set to 64 MB → red: “an oversized response …”
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const https = require('node:https');
const tls = require('node:tls');

const _req = require('./helpers/sources').buildAndRequire();
const { portOf } = require('./helpers/server');
const G = _req('src/vouchers/balanceLookup.js');
/** The session store that the compartment of the voucher services otherwise holds. */
const vorrat = new Map();
const { FetchError } = _req('src/infra/fetch.js');
// The real fetch, as the services pass it via their sources (src/externalSources/sources.ts).
const { legoFetch } = require('./helpers/sources').testServices().externalSources.quellen;

const FIX = path.join(__dirname, 'fixtures');
const cert = fs.readFileSync(path.join(FIX, 'fetch-test.crt'));
const NUMBER = '6006491234567890123',
  PIN = '4711';
const TOKEN = [
  Buffer.from('{"alg":"none"}').toString('base64url'),
  Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 3600 })).toString('base64url'),
  'x',
].join('.');

let modus = 'gut',
  port = 0;
const gesehen = [];
const server = https.createServer({ key: fs.readFileSync(path.join(FIX, 'fetch-test.key')), cert }, (req, res) => {
  let rumpf = '';
  req.on('data', d => {
    rumpf += d;
  });
  req.on('end', () => {
    gesehen.push({
      host: req.headers.host,
      methode: req.method,
      pfad: req.url,
      keks: req.headers.cookie || '',
      auth: req.headers.authorization || '',
      rumpf,
    });
    if (req.url === '/de-ch/gift-cards/balance') {
      if (modus === 'umleitung') {
        res.writeHead(302, { Location: 'https://example.org/de-ch/gift-cards/balance' });
        return res.end();
      }
      res.writeHead(200, { 'Set-Cookie': ['sitzung=s1; Path=/', 'bot=b2; Path=/'] });
      return res.end('<html>Guthaben</html>');
    }
    if (req.url === '/api/graphql/Login' && req.method === 'POST') {
      res.writeHead(200, { 'Set-Cookie': `gqauth=${TOKEN}; Path=/`, 'Content-Type': 'application/json' });
      return res.end('{"data":{"login":null}}');
    }
    if (req.url === '/api/graphql/giftCardBalanceQuery' && req.method === 'POST') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      if (modus === 'gross') {
        res.write('{"data":"');
        res.write(Buffer.alloc(2 * 1024 * 1024, 0x61));
        return res.end('"}');
      }
      return res.end(
        JSON.stringify({
          data: { giftCard: { balance: { centAmount: 1250, currencyCode: 'CHF', formattedAmount: 'CHF 12.50' } } },
        }),
      );
    }
    res.writeHead(404);
    res.end();
  });
});

/** Every host lands at the test server; the certificate does not apply to www.lego.com. */
class Umlenker extends https.Agent {
  createConnection(opt, cb) {
    return tls.connect(
      {
        ...opt,
        host: '127.0.0.1',
        port,
        ca: cert,
        servername: opt.servername || opt.host,
        checkServerIdentity: () => undefined,
      },
      cb,
    );
  }
}

const vorher = https.globalAgent;
test.before(async () => {
  await new Promise(r => server.listen(0, '127.0.0.1', () => r(null)));
  port = portOf(server);
  https.globalAgent = new Umlenker();
});
test.after(() => {
  https.globalAgent = vorher;
  server.closeAllConnections();
  server.close();
});
test.beforeEach(() => {
  gesehen.length = 0;
  vorrat.clear();
});

test('cookies, token and body arrive via the real fetch path', async () => {
  modus = 'gut';
  const g = await G.fetchBalance(vorrat, NUMBER, PIN, { locale: 'de-CH', fetch: legoFetch });
  assert.deepEqual(g, { amount: 12.5, currency: 'CHF', formatted: 'CHF 12.50' });
  assert.deepEqual(
    gesehen.map(a => `${a.methode} ${a.pfad}`),
    ['GET /de-ch/gift-cards/balance', 'POST /api/graphql/Login', 'POST /api/graphql/giftCardBalanceQuery'],
  );
  const abfrage = gesehen[2];
  assert.ok(
    gesehen.every(a => a.host === 'www.lego.com'),
    JSON.stringify(gesehen.map(a => a.host)),
  );
  assert.match(abfrage.keks, /sitzung=s1/);
  assert.match(abfrage.keks, new RegExp(`gqauth=${TOKEN.replace(/\./g, '\\.')}`));
  assert.equal(abfrage.auth, TOKEN);
  assert.deepEqual(JSON.parse(abfrage.rumpf).variables, { cardNumber: NUMBER, pin: PIN });
});

test('a redirect to a foreign host is not followed', async () => {
  modus = 'umleitung';
  await assert.rejects(
    G.fetchBalance(vorrat, NUMBER, PIN, { locale: 'de-CH', fetch: legoFetch }),
    (/** @type {any} */ e) => e instanceof FetchError && e.grund === 'umleitung',
  );
  assert.ok(gesehen.length >= 1, 'der Testserver wurde nicht gefragt');
  assert.deepEqual(
    gesehen.filter(a => a.host !== 'www.lego.com'),
    [],
  );
});

test('an oversized response is aborted', async () => {
  modus = 'gross';
  await assert.rejects(
    G.fetchBalance(vorrat, NUMBER, PIN, { locale: 'de-CH', fetch: legoFetch }),
    (/** @type {any} */ e) => e instanceof FetchError && e.grund === 'zu-gross',
  );
});
