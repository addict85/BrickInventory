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
const stockList = new Map();
const { FetchError } = _req('src/infra/fetch.js');
// The real fetch, as the services pass it via their sources (src/externalSources/sources.ts).
const { legoFetch } = require('./helpers/sources').testServices().externalSources.sources;

const FIX = path.join(__dirname, 'fixtures');
const cert = fs.readFileSync(path.join(FIX, 'fetch-test.crt'));
const NUMBER = '6006491234567890123',
  PIN = '4711';
const TOKEN = [
  Buffer.from('{"alg":"none"}').toString('base64url'),
  Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 3600 })).toString('base64url'),
  'x',
].join('.');

let mode = 'gut',
  port = 0;
const seen = [];
const server = https.createServer({ key: fs.readFileSync(path.join(FIX, 'fetch-test.key')), cert }, (req, res) => {
  let body = '';
  req.on('data', d => {
    body += d;
  });
  req.on('end', () => {
    seen.push({
      host: req.headers.host,
      method: req.method,
      path: req.url,
      keks: req.headers.cookie || '',
      auth: req.headers.authorization || '',
      body,
    });
    if (req.url === '/de-ch/gift-cards/balance') {
      if (mode === 'umleitung') {
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
      if (mode === 'gross') {
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
class Redirector extends https.Agent {
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

const prior = https.globalAgent;
test.before(async () => {
  await new Promise(r => server.listen(0, '127.0.0.1', () => r(null)));
  port = portOf(server);
  https.globalAgent = new Redirector();
});
test.after(() => {
  https.globalAgent = prior;
  server.closeAllConnections();
  server.close();
});
test.beforeEach(() => {
  seen.length = 0;
  stockList.clear();
});

test('cookies, token and body arrive via the real fetch path', async () => {
  mode = 'gut';
  const g = await G.fetchBalance(stockList, NUMBER, PIN, { locale: 'de-CH', fetch: legoFetch });
  assert.deepEqual(g, { amount: 12.5, currency: 'CHF', formatted: 'CHF 12.50' });
  assert.deepEqual(
    seen.map(a => `${a.method} ${a.path}`),
    ['GET /de-ch/gift-cards/balance', 'POST /api/graphql/Login', 'POST /api/graphql/giftCardBalanceQuery'],
  );
  const query = seen[2];
  assert.ok(
    seen.every(a => a.host === 'www.lego.com'),
    JSON.stringify(seen.map(a => a.host)),
  );
  assert.match(query.keks, /sitzung=s1/);
  assert.match(query.keks, new RegExp(`gqauth=${TOKEN.replace(/\./g, '\\.')}`));
  assert.equal(query.auth, TOKEN);
  assert.deepEqual(JSON.parse(query.body).variables, { cardNumber: NUMBER, pin: PIN });
});

test('a redirect to a foreign host is not followed', async () => {
  mode = 'umleitung';
  await assert.rejects(
    G.fetchBalance(stockList, NUMBER, PIN, { locale: 'de-CH', fetch: legoFetch }),
    (/** @type {any} */ e) => e instanceof FetchError && e.reason === 'umleitung',
  );
  assert.ok(seen.length >= 1, 'the test server was not asked');
  assert.deepEqual(
    seen.filter(a => a.host !== 'www.lego.com'),
    [],
  );
});

test('an oversized response is aborted', async () => {
  mode = 'gross';
  await assert.rejects(
    G.fetchBalance(stockList, NUMBER, PIN, { locale: 'de-CH', fetch: legoFetch }),
    (/** @type {any} */ e) => e instanceof FetchError && e.reason === 'zu-gross',
  );
});
