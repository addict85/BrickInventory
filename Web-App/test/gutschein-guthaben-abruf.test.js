/**
 * Die Guthaben-Abfrage mit ihrem echten Abrufweg (src/infra/abruf.ts) gegen
 * einen TLS-Server, der sich als www.lego.com ausgibt: Ein Agent lenkt jede
 * Verbindung auf 127.0.0.1, nichts geht hinaus. Kekse, Token und POST-Rumpf
 * kommen an; eine Umleitung auf einen fremden Host und eine übergrosse Antwort
 * werden zum Fehler, statt Kartennummer und PIN weiterzureichen.
 *
 * Gegenproben (am 02.11.2026 gemessen):
 *   A  holeGuthaben wieder mit globalThis.fetch → rot: alle drei (der
 *      Testserver sieht keine Anfrage, fetch nimmt den Agenten nicht)
 *   B  in legoAbruf die Hostliste um example.org erweitert → rot: „eine
 *      Umleitung auf einen fremden Host …“ (example.org wird angefragt)
 *   C  in abruf.ts `req.end(o.rumpf)` ohne Rumpf → rot: „Kekse, Token und
 *      Rumpf …“ (die Abfrage kommt ohne Kartennummer an)
 *   D  maxBytes der POST-Antwort auf 64 MB → rot: „eine übergrosse Antwort …“
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const https = require('node:https');
const tls = require('node:tls');

const _req = require('./helpers/sources').buildAndRequire();
const G = _req('src/gutscheine/gutscheinGuthaben.js');
const { AbrufFehler } = _req('src/infra/abruf.js');

const FIX = path.join(__dirname, 'fixtures');
const cert = fs.readFileSync(path.join(FIX, 'abruf-test.crt'));
const NUMMER = '6006491234567890123', PIN = '4711';
const TOKEN = [Buffer.from('{"alg":"none"}').toString('base64url'),
  Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 3600 })).toString('base64url'), 'x'].join('.');

let modus = 'gut', port = 0;
const gesehen = [];
const server = https.createServer({ key: fs.readFileSync(path.join(FIX, 'abruf-test.key')), cert }, (req, res) => {
  let rumpf = '';
  req.on('data', d => { rumpf += d; });
  req.on('end', () => {
    gesehen.push({ host: req.headers.host, methode: req.method, pfad: req.url, keks: req.headers.cookie || '',
      auth: req.headers.authorization || '', rumpf });
    if (req.url === '/de-ch/gift-cards/balance') {
      if (modus === 'umleitung') { res.writeHead(302, { Location: 'https://example.org/de-ch/gift-cards/balance' }); return res.end(); }
      res.writeHead(200, { 'Set-Cookie': ['sitzung=s1; Path=/', 'bot=b2; Path=/'] });
      return res.end('<html>Guthaben</html>');
    }
    if (req.url === '/api/graphql/Login' && req.method === 'POST') {
      res.writeHead(200, { 'Set-Cookie': `gqauth=${TOKEN}; Path=/`, 'Content-Type': 'application/json' });
      return res.end('{"data":{"login":null}}');
    }
    if (req.url === '/api/graphql/giftCardBalanceQuery' && req.method === 'POST') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      if (modus === 'gross') { res.write('{"data":"'); res.write(Buffer.alloc(2 * 1024 * 1024, 0x61)); return res.end('"}'); }
      return res.end(JSON.stringify({ data: { giftCard: { balance: { centAmount: 1250, currencyCode: 'CHF', formattedAmount: 'CHF 12.50' } } } }));
    }
    res.writeHead(404); res.end();
  });
});

/** Jeder Host landet beim Testserver; das Zertifikat gilt nicht für www.lego.com. */
class Umlenker extends https.Agent {
  createConnection(opt, cb) {
    return tls.connect({ ...opt, host: '127.0.0.1', port, ca: cert, servername: opt.servername || opt.host,
      checkServerIdentity: () => undefined }, cb);
  }
}

const vorher = https.globalAgent;
test.before(async () => {
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  port = server.address().port;
  https.globalAgent = new Umlenker();
});
test.after(() => { https.globalAgent = vorher; server.closeAllConnections(); server.close(); });
test.beforeEach(() => { gesehen.length = 0; G.vergesseSitzungen(); });

test('Kekse, Token und Rumpf kommen über den echten Abrufweg an', async () => {
  modus = 'gut';
  const g = await G.holeGuthaben(NUMMER, PIN, { locale: 'de-CH' });
  assert.deepEqual(g, { betrag: 12.5, waehrung: 'CHF', angezeigt: 'CHF 12.50' });
  assert.deepEqual(gesehen.map(a => `${a.methode} ${a.pfad}`),
    ['GET /de-ch/gift-cards/balance', 'POST /api/graphql/Login', 'POST /api/graphql/giftCardBalanceQuery']);
  const abfrage = gesehen[2];
  assert.ok(gesehen.every(a => a.host === 'www.lego.com'), JSON.stringify(gesehen.map(a => a.host)));
  assert.match(abfrage.keks, /sitzung=s1/);
  assert.match(abfrage.keks, new RegExp(`gqauth=${TOKEN.replace(/\./g, '\\.')}`));
  assert.equal(abfrage.auth, TOKEN);
  assert.deepEqual(JSON.parse(abfrage.rumpf).variables, { cardNumber: NUMMER, pin: PIN });
});

test('eine Umleitung auf einen fremden Host wird nicht befolgt', async () => {
  modus = 'umleitung';
  await assert.rejects(G.holeGuthaben(NUMMER, PIN, { locale: 'de-CH' }),
    e => e instanceof AbrufFehler && e.grund === 'umleitung');
  assert.ok(gesehen.length >= 1, 'der Testserver wurde nicht gefragt');
  assert.deepEqual(gesehen.filter(a => a.host !== 'www.lego.com'), []);
});

test('eine übergrosse Antwort wird abgebrochen', async () => {
  modus = 'gross';
  await assert.rejects(G.holeGuthaben(NUMMER, PIN, { locale: 'de-CH' }),
    e => e instanceof AbrufFehler && e.grund === 'zu-gross');
});
