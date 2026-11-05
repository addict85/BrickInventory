'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

/**
 * HSTS — aber nur ueber eine verschluesselte Verbindung.
 * Ausführlich: docs/begruendungen/test/hsts.test.js.md#wurzel
 */

const WURZEL = path.join(__dirname, '..');
/**
 * Kommentare raus — zeilenweise, NICHT ueber einen Regex auf /* … *\/.
 * Ausführlich: docs/begruendungen/test/hsts.test.js.md#ohnekommentare
 */
const ohneKommentare = (s) => {
  const zeilen = [];
  let imBlock = false;
  for (const z of s.split('\n')) {
    const t = z.trim();
    if (imBlock) { zeilen.push(''); if (t.endsWith('*/')) imBlock = false; continue; }
    if (t.startsWith('/*')) { zeilen.push(''); if (!t.includes('*/')) imBlock = true; continue; }
    zeilen.push(t.startsWith('//') || t.startsWith('*') ? '' : z);
  }
  return zeilen.join('\n');
};

const serverRoh = fs.readFileSync(path.join(WURZEL, 'server.ts'), 'utf8');
const server = ohneKommentare(serverRoh);
// Selbstbeweis, aus dem Fehler oben geboren: Bleibt nach dem Streichen zu
// wenig uebrig, laufen alle Zusicherungen ins Leere und schweigen.
// Die Schwelle ist GEMESSEN, nicht geraten: server.ts besteht zu rund 55%
// aus Erklaerung — Hausstil, kein Zufall. Der erste Entwurf stand auf 50% …
// Ausführlich: docs/begruendungen/test/hsts.test.js.md#stelle
assert.ok(server.length > serverRoh.length * 0.25,
  `Nach dem Streichen der Kommentare sind nur noch ${server.length} von ` +
  `${serverRoh.length} Zeichen uebrig — der Filter frisst Code.`);
// Und die Gegenprobe dazu: Eine Groessenangabe allein sagt nichts darueber,
// WAS uebrig ist.
// Ausführlich: docs/begruendungen/test/hsts.test.js.md#stelle-2
assert.ok(server.includes("setHeader('X-Frame-Options'"),
  'Der Kommentarfilter hat den Kopfzeilen-Block zerstoert');

test('die Kopfzeile wird gesetzt', () => {
  assert.match(server, /setHeader\('Strict-Transport-Security'/,
    'Strict-Transport-Security fehlt — die erste Anfrage nach einem getippten ' +
    'Hostnamen geht dann im Klartext hinaus, samt Cookie.');
  assert.match(server, /max-age=\$\{[^}]+\}; includeSubDomains/,
    'Die Kopfzeile nennt keine Gueltigkeitsdauer mit includeSubDomains mehr');
});

test('sie wird NUR ueber eine verschluesselte Verbindung gesetzt', () => {
  // Der eigentliche Punkt. Ohne diese Bedingung sperrt die Haertung den
  // LAN-Zugang aus, sobald derselbe Host je einmal ueber https lief.
  const i = server.indexOf("setHeader('Strict-Transport-Security'");
  assert.ok(i > 0, 'Die Kopfzeile ist nicht mehr zu finden');
  const davor = server.slice(Math.max(0, i - 500), i);
  assert.match(davor, /if \(ueberTls/,
    'Die Kopfzeile wird ohne Bedingung gesetzt — dann gilt HSTS auch fuer den ' +
    'LAN-Betrieb ueber http, und der Browser sperrt ihn dauerhaft aus.');
});

test('verschluesselt heisst req.secure, nicht ein roher Kopf', () => {
  // X-Forwarded-Proto kann jeder Client selbst schicken; nur hinter einem
  // vertrauten Proxy (trust proxy, src/infra/proxyVertrauen.ts) macht Express
  // daraus req.secure. Sonst setzte ein gefälschter Kopf HSTS im LAN-Betrieb.
  // Gegenprobe (01.11.2026): `|| req.headers['x-forwarded-proto'] === 'https'`
  // wieder angehängt → rot.
  const m = /const ueberTls = ([^;]+);/.exec(server);
  assert.ok(m, 'Die Erkennung der verschluesselten Verbindung ist weg');
  assert.equal(m[1].trim(), 'req.secure');
});

test('die Kopfzeile laesst sich abstellen', () => {
  // HSTS klebt im Browser. Wer eine Fehlkonfiguration bemerkt, muss sie
  // abstellen koennen, ohne auf den Ablauf zu warten.
  assert.match(fs.readFileSync(path.join(__dirname, '..', 'src/infra/konfig.ts'), 'utf8'), /'HSTS_MAX_AGE'/,
    'Es gibt keinen Weg mehr, HSTS abzustellen');
  assert.match(server, /konfig\(\)\.hstsMaxAge/, 'server.ts liest HSTS_MAX_AGE nicht aus der Konfiguration');
  assert.match(server, /hstsAlter !== 0/,
    'HSTS_MAX_AGE=0 schaltet die Kopfzeile nicht mehr ab');
});

test('die uebrigen Sicherheitskopfzeilen stehen weiter da', () => {
  // Selbstbeweis: Findet dieser Block nichts, prueft der Test oben an einer
  // Stelle, die es nicht mehr gibt.
  for (const kopf of ['X-Frame-Options', 'X-Content-Type-Options',
                      'Referrer-Policy', 'Permissions-Policy',
                      'Content-Security-Policy'])
    assert.ok(server.includes(`setHeader('${kopf}'`), `${kopf} ist verschwunden`);
});
