const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const WEB = path.join(__dirname, '..');

/**
 * Jede Route ist bewacht — oder steht namentlich auf der Liste der oeffentlichen.
 *
 * ── Warum das eine eigene Pruefung braucht ──────────────────────────────────
 *
 * Der Schutz steht POSITIONELL: `router.use(requireLogin)` bewacht alles, was
 * DARUNTER in der Datei steht. Das ist knapp und richtig — aber es heisst auch,
 * dass eine neue Route zehn Zeilen zu weit oben still oeffentlich ist. Kein
 * Fehler, keine Warnung, nichts im Test: Sie funktioniert, und zwar fuer jeden.
 *
 * GEMESSEN beim Schreiben dieser Pruefung: Kein einziger Fall. Alles, was heute
 * ueber seiner Wache steht, gehoert dorthin — Anmeldung, Registrierung,
 * Passwort vergessen, und das Design vor dem Login. Genau deshalb ist jetzt der
 * richtige Zeitpunkt, den Stand festzuhalten: Die Liste unten ist kurz und
 * jeder Eintrag begruendbar. Waechst sie, muss jemand sie begruenden.
 *
 * ── Warum eine Liste und keine Regel ────────────────────────────────────────
 *
 * „Alles muss bewacht sein" waere falsch: Man kann sich nicht anmelden, wenn
 * die Anmeldung Anmeldung verlangt. Die Ausnahmen sind eine
 * ENTSCHEIDUNG und gehoeren aufgeschrieben, nicht abgeleitet.
 */

/** Absichtlich ohne Anmeldung erreichbar — mit Grund. */
const OEFFENTLICH = new Map([
  ['auth.ts POST /login',               'Die Anmeldung selbst'],
  ['auth.ts POST /logout',              'Muss auch ohne gueltige Sitzung gehen'],
  ['auth.ts GET /me',                   'Antwortet „nicht angemeldet" — der Startpunkt der Oberflaeche'],
  ['auth.ts POST /qr-login',            'Anmeldung per QR-Code'],
  ['auth.ts GET /registration-status',  'Ob Registrierung offen ist — vor dem Konto'],
  ['auth.ts POST /register',            'Das Konto entsteht hier erst'],
  ['auth.ts POST /forgot-password',     'Wer sein Passwort vergisst, kann sich nicht anmelden'],
  ['auth.ts POST /reset-password',      'Dasselbe, zweiter Schritt'],
  ['settings.ts GET /theme',            'Das Design des Login-Bildschirms, vor jeder Anmeldung'],
]);

// Jede Wache in diesem Baum heisst `require…` — requireLogin, requireToken,
// requireLoginOrToken, requireApiAdmin. Die erste Fassung zaehlte sie einzeln
// auf und uebersah `requireApiAdmin`: Sie meldete daraufhin alle 23
// Verwalter-Routen als offen, obwohl jede einzelne bewacht ist. Wieder eine
// Aufzaehlung, die nicht mitgewachsen ist — diesmal in meiner eigenen Pruefung.
const WACHEN = /\brequire[A-Z]\w*/;

function routen(datei) {
  const s = fs.readFileSync(datei, 'utf8');
  const wache = s.search(/^router\.use\(require\w+\)/m);
  const raus = [];
  for (const m of s.matchAll(/^router\.(get|post|put|delete|patch)\(\s*'([^']*)'([^\n]*)/gm)) {
    const eigen = WACHEN.test(m[3]);
    const dahinter = wache >= 0 && m.index > wache;
    if (eigen || dahinter) continue;
    raus.push(`${path.basename(datei)} ${m[1].toUpperCase()} ${m[2]}`);
  }
  return raus;
}

test('keine Route ist unbeabsichtigt ohne Anmeldung erreichbar', () => {
  const dateien = [
    ...fs.readdirSync(path.join(WEB, 'routes')).filter(n => n.endsWith('.ts'))
      .map(n => path.join(WEB, 'routes', n)),
    ...fs.readdirSync(path.join(WEB, 'routes', 'api_v1')).filter(n => n.endsWith('.ts'))
      .map(n => path.join(WEB, 'routes', 'api_v1', n)),
  ];
  assert.ok(dateien.length >= 10, `Nur ${dateien.length} Routendateien — greift die Suche noch?`);

  const offen = dateien.flatMap(routen).sort();
  // Selbstbeweis: Findet die Suche ueberhaupt Routen? Ohne diesen Schritt waere
  // die Zusicherung darunter gruen, sobald sich die Schreibweise aendert.
  const alle = dateien.reduce((n, f) =>
    n + [...fs.readFileSync(f, 'utf8').matchAll(/^router\.(get|post|put|delete|patch)\(/gm)].length, 0);
  assert.ok(alle >= 80, `Nur ${alle} Routen gefunden — greift die Suche noch?`);
  // Zweiter Selbstbeweis: Greift das Wachenmuster? Faende es nichts, waere
  // JEDE Route „offen" und die Liste unten sofort riesig — auffaellig. Faende
  // es zu viel, waere alles „bewacht" und die Pruefung still gruen. GEMESSEN
  // tragen die meisten Routen eine Wache im Kopf.
  const mitWache = dateien.reduce((n, f) =>
    n + [...fs.readFileSync(f, 'utf8').matchAll(/^router\.\w+\([^\n]*\brequire[A-Z]/gm)].length, 0);
  assert.ok(mitWache >= 40,
    `Nur ${mitWache} Routen mit Wache im Kopf — greift das Wachenmuster noch?`);

  const unerwartet = offen.filter(r => !OEFFENTLICH.has(r));
  assert.deepEqual(unerwartet, [],
    'Diese Routen sind ohne Anmeldung erreichbar und stehen nicht auf der Liste ' +
    'der beabsichtigten Ausnahmen. Entweder gehoert die Route unter das ' +
    '`router.use(requireLogin)` ihrer Datei — oder sie gehoert mit Begruendung ' +
    'in OEFFENTLICH.');

  // Und andersherum: Eine Ausnahme, die es nicht mehr gibt, gehoert geloescht.
  const verwaist = [...OEFFENTLICH.keys()].filter(k => !offen.includes(k));
  assert.deepEqual(verwaist, [],
    'Diese Ausnahmen stehen auf der Liste, aber die Route ist inzwischen ' +
    'bewacht oder weg. Eine Ausnahmeliste, die niemand aufraeumt, wird zur ' +
    'Tapete.');
});
