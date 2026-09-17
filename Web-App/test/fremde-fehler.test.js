const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const QUELLE = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', '08-init.js'), 'utf8');

/**
 * Das Auffangnetz faengt nur UNSERE Fehler.
 *
 * ── Der Befund aus dem Betrieb ──────────────────────────────────────────────
 *
 * Marcos Konsole zeigte, rot und mit unserem Bundle als Quelle:
 *
 *     [promise] i: Failed to connect to MetaMask
 *     Caused by: Error: MetaMask extension not found
 *       at inpage.js:4:42708
 *
 * MetaMask ist eine Browser-Erweiterung und hat mit BrickInventory nichts zu
 * tun. Der Lauscher in 08-init.js hoert aber am FENSTER, und dort landet jede
 * unbehandelte Ablehnung der Seite. Wir haben sie als unsere protokolliert —
 * und Marco dazu eine Meldung „Unerwarteter Fehler" angezeigt. Er sollte also
 * einen Fehler unserer Anwendung sehen, weil SEINE Wallet-Erweiterung ihre
 * Wallet nicht fand.
 *
 * ── Warum das mehr ist als Kosmetik ─────────────────────────────────────────
 *
 * Dieselbe Ueberlegung wie beim leeren Bildquell eine Runde vorher: Ein
 * Warnzeichen, das regelmaessig ohne Anlass erscheint, wird nicht gelesen.
 * Hier trifft es zusaetzlich den Benutzer und nicht nur die Konsole.
 *
 * ── Warum der Test die FUNKTION laufen laesst ───────────────────────────────
 *
 * Ein Nachbau der Regel im Test prueft den Nachbau. Deshalb wird `vonUns`
 * woertlich aus der Quelldatei geschnitten und ausgefuehrt — mit gestelltem
 * `location`, weil es im Browser lebt.
 */

/** `vonUns` woertlich aus 08-init.js holen und mit gestelltem Ursprung laufen lassen. */
function holeVonUns(ursprung = 'https://lego.bigolin.online') {
  const auf = QUELLE.indexOf('function vonUns(');
  assert.ok(auf > 0, 'vonUns() steht nicht mehr in 08-init.js — heisst die Regel noch so?');
  const zu = QUELLE.indexOf('\n}', auf) + 2;
  const text = QUELLE.slice(auf, zu);
  assert.ok(text.includes('location.origin'),
    'vonUns() vergleicht nicht mehr gegen den eigenen Ursprung — greift der Schnitt noch?');
  // eslint-disable-next-line no-new-func
  return new Function('location', `${text}; return vonUns;`)({ origin: ursprung });
}

const mitStapel = (nachricht, stapel) => Object.assign(new Error(nachricht), { stack: stapel });
const UNS = 'https://lego.bigolin.online';

test('eine Erweiterung loest bei uns keinen Fehler aus', () => {
  const vonUns = holeVonUns(UNS);
  // Der Stapel aus Marcos Konsole, so wie Chromium ihn schreibt.
  const metamask = mitStapel('Failed to connect to MetaMask',
    'Error: MetaMask extension not found\n' +
    '    at Object.connect (chrome-extension://nkbihfbeogaeaoehlefnkodbefgpgknn/inpage.js:4:42708)\n' +
    '    at chrome-extension://nkbihfbeogaeaoehlefnkodbefgpgknn/inpage.js:7:84292');
  assert.equal(vonUns(metamask), false, 'MetaMask gilt weiter als unser Fehler');
  assert.equal(vonUns(mitStapel('x', 'Error: x\n    at moz-extension://abc/inpage.js:1:1')), false,
    'Firefox-Erweiterungen gelten als unser Fehler');
  assert.equal(vonUns(mitStapel('x', 'Error: x\n    at https://cdn.example.com/w.js:1:1')), false,
    'Ein fremder Host gilt als unser Fehler');
});

test('unsere eigenen Fehler kommen weiterhin an', () => {
  const vonUns = holeVonUns(UNS);
  assert.equal(vonUns(mitStapel('kaputt', `TypeError: kaputt\n    at h (${UNS}/js/app.bundle.js:428:12)`)), true,
    'Ein Fehler aus unserem Bundle wird verschluckt');
  assert.equal(vonUns(mitStapel('kaputt', `Error: kaputt\n    at ${UNS}/:17:3`)), true,
    'Ein Fehler aus der Seite selbst wird verschluckt');
  // Eine Erweiterung, die UNSEREN Code aufruft und dort etwas ausloest, ist
  // unser Fehler: Der Stapel nennt beide, und eine Adresse von uns genuegt.
  assert.equal(vonUns(mitStapel('x',
    `Error: x\n    at chrome-extension://abc/inpage.js:1:1\n    at ${UNS}/js/app.bundle.js:9:1`)), true,
    'Ein Fehler in unserem Code wird verschluckt, weil eine Erweiterung ihn ausgeloest hat');
});

test('im Zweifel gilt der Fehler als unserer', () => {
  // Der teurere der beiden Irrtuemer ist der verschwiegene EIGENE Fehler —
  // genau dagegen gibt es dieses Netz. Ohne Stapel oder ohne erkennbare
  // Adresse wird deshalb weiter gemeldet.
  const vonUns = holeVonUns(UNS);
  assert.equal(vonUns('nur ein Text'), true, 'Eine Ablehnung ohne Stapel wird verschluckt');
  assert.equal(vonUns(undefined), true, 'Eine Ablehnung ohne Wert wird verschluckt');
  assert.equal(vonUns(mitStapel('x', 'Error: x\n    at <anonymous>')), true,
    'Ein Stapel ohne Adresse wird verschluckt');
});

test('ein fremder Host mit unserem Namen als Anfang zaehlt nicht als unserer', () => {
  // `startsWith(origin)` ohne den Schraegstrich wuerde
  // https://lego.bigolin.online.boeswillig.example als unseren lesen.
  const vonUns = holeVonUns(UNS);
  assert.equal(vonUns(mitStapel('x', `Error: x\n    at ${UNS}.boeswillig.example/w.js:1:1`)), false,
    'Ein fremder Host, der mit unserem Ursprung anfaengt, gilt als unserer');
});

test('beide Lauscher gehen durch die Pruefung', () => {
  // Nicht nur der fuer Ablehnungen: `window.onerror` faengt Skriptfehler, und
  // die einer Erweiterung landen dort genauso.
  //
  // ── Warum Klammern gezaehlt werden ──────────────────────────────────────
  //
  // Die erste Fassung schnitt den Lauscher mit `indexOf('});')` heraus. Die
  // GEGENPROBE — die Pruefung im Ablehnungs-Lauscher ausbauen — blieb damit
  // gruen: Ohne geschweiften Block endet der Aufruf mit `);`, das gesuchte
  // `});` stand erst im NAECHSTEN Lauscher, und der trug die Pruefung noch.
  // Der Test hat also den falschen Text angesehen und bestanden. Gezaehlte
  // Klammern nehmen genau ein Argument.
  const argument = (text, ab) => {
    let tiefe = 0;
    for (let i = text.indexOf('(', ab); i < text.length; i++) {
      if (text[i] === '(') tiefe++;
      else if (text[i] === ')' && --tiefe === 0) return text.slice(ab, i + 1);
    }
    return '';
  };
  for (const ereignis of ['unhandledrejection', 'error']) {
    const i = QUELLE.indexOf(`addEventListener('${ereignis}'`);
    assert.ok(i > 0, `Der Lauscher fuer '${ereignis}' fehlt`);
    const block = argument(QUELLE, i);
    assert.ok(block.includes(`'${ereignis}'`) && block.length > 30,
      `Der Lauscher fuer '${ereignis}' liess sich nicht herausschneiden — greift die Suche noch?`);
    assert.match(block, /vonUns\(/,
      `Der Lauscher fuer '${ereignis}' meldet ungeprueft — dann kommen fremde ` +
      'Fehler weiter als unsere an.');
  }
});

test('keine liegengebliebene Fehlersuche im Auslieferungsstand', () => {
  // ── Der zweite Befund aus derselben Konsole ──────────────────────────────
  //
  //   [showApp] called, scheduling gibCheckOnLoad
  //   [gibCheckOnLoad] firing
  //
  // Zwei console.log aus einer Fehlersuche, die im Betrieb stehen geblieben
  // sind. Keine Fehler — aber sie stehen zwischen den echten Meldungen.
  //
  // Geprueft wird die Form, nicht eine Liste von Namen: `console.log` mit
  // einem Text in eckigen Klammern ist das Muster, in dem hier
  // Fehlersuchspuren geschrieben werden.
  const ordner = path.join(__dirname, '..', 'public', 'js');
  const dateien = fs.readdirSync(ordner).filter(n => n.endsWith('.js') && n !== 'app.bundle.js');
  assert.ok(dateien.length >= 10, `Nur ${dateien.length} Skripte — greift die Suche noch?`);

  const spuren = [];
  for (const name of dateien) {
    fs.readFileSync(path.join(ordner, name), 'utf8').split('\n').forEach((z, i) => {
      if (/^\s*\/\//.test(z)) return;
      for (const m of z.matchAll(/console\.log\(\s*['"`]\[/g)) {
        void m;
        spuren.push(`${name}:${i + 1}  ${z.trim().slice(0, 80)}`);
      }
    });
  }
  assert.deepEqual(spuren, [],
    'Diese console.log sehen nach Fehlersuche aus und stehen im ' +
    'Auslieferungsstand. Sie stehen zwischen den echten Meldungen.');
});
