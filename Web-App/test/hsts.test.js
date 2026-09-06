'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

/**
 * HSTS — aber nur ueber eine verschluesselte Verbindung.
 *
 * ── Warum die Kopfzeile fehlte, und warum sie hingehoert ────────────────────
 * Die uebrigen Sicherheitskopfzeilen standen alle da (X-Frame-Options,
 * X-Content-Type-Options, Referrer-Policy, Permissions-Policy, CSP), nur
 * Strict-Transport-Security nicht. Ohne sie geht die allererste Anfrage nach
 * einem getippten Hostnamen im Klartext hinaus — samt Cookie, wenn
 * COOKIE_SECURE nicht gesetzt ist. Die Umleitung auf https ist die ANTWORT
 * darauf; da war die Anfrage schon unterwegs.
 *
 * ── Warum dieser Test vor allem die BEDINGUNG prueft ────────────────────────
 * Derselbe Server laeuft bei vielen im LAN unter http://192.168.x.x:3000.
 * Ein Browser ignoriert HSTS ueber Klartext zwar — aber sobald derselbe Host
 * je einmal ueber https erreichbar war, merkt er sich die Regel und verweigert
 * danach JEDEN http-Zugriff, ein Jahr lang.
 *
 * Ein Test, der nur „die Kopfzeile ist da" prueft, wuerde die Fassung ohne
 * Bedingung durchwinken — also genau die, die den LAN-Zugang aussperrt. Er
 * saehe aus wie eine Absicherung und waere das Gegenteil.
 */

const WURZEL = path.join(__dirname, '..');
/**
 * Kommentare raus — zeilenweise, NICHT ueber einen Regex auf /* … *\/.
 *
 * Der erste Anlauf tat genau das und loeschte 15 000 Zeichen mitten aus
 * server.ts: Die Datei enthaelt Routen wie `'/data/instructions/*'`, und das
 * `/*` darin gilt dem Regex als Kommentaranfang. Alles bis zum naechsten
 * `*\/` war weg — samt des Kopfzeilen-Blocks, um den es hier geht.
 *
 * Aufgefallen ist es nur, weil der letzte Test unten prueft, dass die
 * UEBRIGEN Kopfzeilen noch da sind. Ohne diesen Selbstbeweis waeren alle
 * Zusicherungen an einer leeren Stelle gelaufen und haetten geschwiegen.
 *
 * Zeilenweise geht, weil dieser Baum Blockkommentare immer am Zeilenanfang
 * beginnt. Ein Zaehler haelt fest, dass ueberhaupt etwas uebrig bleibt.
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
// aus Erklaerung — Hausstil, kein Zufall. Der erste Entwurf stand auf 50%
// und war damit selbst rot, obwohl der Filter richtig arbeitete. 25% faengt
// „der Filter frisst Code" und laesst einen kommentierten Baum in Ruhe.
assert.ok(server.length > serverRoh.length * 0.25,
  `Nach dem Streichen der Kommentare sind nur noch ${server.length} von ` +
  `${serverRoh.length} Zeichen uebrig — der Filter frisst Code.`);
// Und die Gegenprobe dazu: Eine Groessenangabe allein sagt nichts darueber,
// WAS uebrig ist.
//
// Als Marke steht hier NUR X-Frame-Options — bewusst etwas, das dieser Test
// nicht prueft. Der erste Entwurf nannte auch Strict-Transport-Security, und
// dann meldete das Entfernen der Kopfzeile „hat das Streichen der Kommentare
// nicht ueberlebt": die falsche Ursache, die den naechsten Leser in die
// falsche Datei schickt. Ein Selbstbeweis prueft das WERKZEUG, nicht den
// Gegenstand der Pruefung — sonst nimmt er ihm die Stimme.
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

test('beide Wege, die Verschluesselung zu erkennen, werden geprueft', () => {
  // req.secure greift hinter dem Reverse-Proxy nur mit `trust proxy` — und das
  // steht in dieser Datei nur unter NODE_ENV === 'production'. Der Kopf
  // x-forwarded-proto greift auch ohne. Einer allein waere eine Regel mit
  // einer Luecke, die niemand sieht.
  const m = /const ueberTls = ([^;]+);/.exec(server);
  assert.ok(m, 'Die Erkennung der verschluesselten Verbindung ist weg');
  assert.match(m[1], /req\.secure/, 'req.secure wird nicht mehr geprueft');
  assert.match(m[1], /x-forwarded-proto'\] === 'https'/,
    'x-forwarded-proto wird nicht mehr geprueft — hinter einem Reverse-Proxy ' +
    'ohne `trust proxy` bliebe HSTS dann stumm');
});

test('die Kopfzeile laesst sich abstellen', () => {
  // HSTS klebt im Browser. Wer eine Fehlkonfiguration bemerkt, muss sie
  // abstellen koennen, ohne auf den Ablauf zu warten.
  assert.match(server, /HSTS_MAX_AGE/,
    'Es gibt keinen Weg mehr, HSTS abzustellen');
  assert.match(server, /hstsAlter !== '0'/,
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
