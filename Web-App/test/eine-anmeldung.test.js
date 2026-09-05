/**
 * „Angemeldet" bedeutet an EINER Stelle etwas, nicht an fünf.
 *
 * ── Der Befund (Nachtrag 127) ───────────────────────────────────────────────
 *
 * Die Android-App war von einundzwanzig Routen ausgesperrt — und zwar von genau
 * denen, deren Fehlen als „die App kann weniger als die Webapp" aufgefallen war:
 *
 *     CSV-Import für Teile und Minifiguren     routes/parts.ts, routes/minifigs.ts
 *     Anleitungen hochladen und löschen        routes/sets.ts
 *     Sicherung exportieren und einspielen     routes/settings.ts
 *     Profil, Passwort ändern                  routes/auth.ts
 *     Nutzerverwaltung                         routes/auth.ts
 *
 * Sechs vermeintlich fehlende Funktionen, EINE Ursache: `routes/auth.ts` hatte
 * ein eigenes `requireLogin`, das ausschliesslich die Sitzung kannte. Die App
 * hat keine Sitzung, sie weist sich mit einem Bearer-Token aus. Der Server
 * konnte alles davon längst — die App kam nur nicht daran.
 *
 * Dazu stand die Frage „wer fragt hier?" in VIER Schreibweisen:
 *
 *     req.session?.userId || req.tokenUserId                 settings.ts
 *     req.tokenUserId || Number(req.session.userId)          sets.ts
 *     req.session?.userId || tokenUser?.user_id              auth.ts
 *     req.apiUser.user_id                                    api_v1/*
 *
 * Der Unterschied ist nicht bloss Geschmack: Zwei davon wandeln in eine Zahl,
 * zwei nicht, und bei einer Anfrage mit Sitzung UND Token liefern sie
 * verschiedene Nutzer.
 *
 * ── Was hier geprüft wird ───────────────────────────────────────────────────
 *
 * GESUCHT, nicht aufgezählt: Jede `.ts` unter routes/ wird gelesen. Wer die
 * Sitzung direkt nach der Nutzerkennung fragt, steht in ERLAUBT — mit dem
 * Grund. Eine neue Route erbt die Regel damit von selbst.
 *
 * Selbstbeweis über eine Mindestzahl: Fände der Durchlauf keine Dateien, wäre
 * die Liste leer und die Prüfung grün, ohne etwas gesehen zu haben.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROUTES = path.join(__dirname, '..', 'routes');

/**
 * Wo die Sitzung direkt gelesen werden DARF — und warum.
 *
 * Die Liste ist bewusst kurz und bewusst nicht leer: Diese Stellen DEFINIEREN,
 * was „angemeldet" heisst, oder handeln von der Sitzung selbst. Wer sie
 * benutzt, statt sie zu definieren, gehört nicht hierher.
 */
const ERLAUBT = {
  'api_v1/middleware.ts':
    'requireToken übersetzt die Sitzung IN die gemeinsame Form (req.apiUser). ' +
    'Hier entsteht sie.',
  'auth.ts':
    'GET /me muss "nicht angemeldet" mit 200 beantworten statt mit 401 und ' +
    'meldet zusätzlich die Laufzeit des Tokens — es kann deshalb nicht hinter ' +
    'dem Wächter stehen. Und /change-password stellt nach dem Verwerfen aller ' +
    'Sitzungen die EIGENE wieder her; das geht nur, wenn es eine gibt.',
};

/** Alle .ts unter routes/, auch in Unterordnern. */
function routenDateien(dir, praefix = '') {
  const gefunden = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) gefunden.push(...routenDateien(path.join(dir, e.name), praefix + e.name + '/'));
    else if (e.name.endsWith('.ts')) gefunden.push([praefix + e.name, path.join(dir, e.name)]);
  }
  return gefunden;
}

test('kein Handler fragt die Sitzung selbst nach der Nutzerkennung', () => {
  const dateien = routenDateien(ROUTES);
  assert.ok(dateien.length >= 10,
    `Nur ${dateien.length} Router-Dateien gefunden — dann prüft der Rest nichts.`);

  const verstoesse = [];
  const gebraucht = new Set();
  for (const [rel, voll] of dateien) {
    const src = fs.readFileSync(voll, 'utf8')
      // Kommentare raus: Ein Erklärtext, der `req.session.userId` NENNT
      // (dieser hier zum Beispiel), ist keine Nutzung.
      .split('\n').filter(z => !z.trimStart().startsWith('//') && !z.trimStart().startsWith('*')).join('\n');
    for (const m of src.matchAll(/req\.session\??\.(userId|isAdmin|username)\b/g)) {
      const zeile = src.slice(0, m.index).split('\n').length;
      // Erlaubte Dateien werden trotzdem DURCHSUCHT: Ihr Treffer belegt, dass
      // die Ausnahme noch etwas beschreibt. Wer sie stattdessen ueberspringt,
      // merkt nie, wenn sie gegenstandslos wird — und dann nimmt ein toter
      // Eintrag eine ganze Datei dauerhaft von der Pruefung aus.
      if (rel in ERLAUBT) gebraucht.add(rel);
      else verstoesse.push(`${rel}:${zeile}  ${m[0]}`);
    }
  }

  const veraltet = Object.keys(ERLAUBT).filter(k => !gebraucht.has(k)).sort();
  assert.deepEqual(veraltet, [],
    'Diese Eintraege in ERLAUBT beschreiben nichts mehr:\n  ' + veraltet.join('\n  ') +
    '\nDie Datei liest die Sitzung gar nicht (mehr) direkt — raus damit.');

  assert.deepEqual(verstoesse, [],
    'Diese Stellen lesen die Sitzung direkt statt nutzerId()/istVerwalter()/nutzerName():\n  ' +
    verstoesse.join('\n  ') +
    '\nMit einem Bearer-Token — dem einzigen Ausweis der App — ist das immer ' +
    'undefined. Das fällt nicht als Fehler auf: Die Route antwortet mit 401, ' +
    'oder schlimmer, sie liefert stillschweigend die Ansicht eines ' +
    'Nicht-Verwalters.');
});

test('kein Router bringt einen eigenen Wächter mit', () => {
  // Der zweite Teil desselben Befunds: routes/auth.ts DEFINIERTE requireLogin
  // und requireAdmin selbst — sitzungsgebunden, während utils/auth.ts und
  // routes/api_v1/middleware.ts längst token-fähige Fassungen hatten. Drei
  // Fassungen einer Regel, und die App konnte nur eine erfüllen.
  const dateien = routenDateien(ROUTES);
  const eigene = [];
  for (const [rel, voll] of dateien) {
    const src = fs.readFileSync(voll, 'utf8');
    for (const m of src.matchAll(/^\s*(?:export\s+)?function\s+(require\w+)\s*\(/gm)) {
      // api_v1/middleware.ts ist der Ort, AN DEM sie stehen sollen.
      if (rel === 'api_v1/middleware.ts') continue;
      eigene.push(`${rel}  function ${m[1]}`);
    }
  }
  assert.deepEqual(eigene, [],
    'Diese Router definieren einen eigenen Anmelde-Wächter:\n  ' + eigene.join('\n  ') +
    '\nEs gibt genau zwei: requireLoginOrToken (utils/auth.ts) und ' +
    'requireApiAdmin (routes/api_v1/middleware.ts). Beide nehmen Sitzung ODER ' +
    'Token. Eine dritte Fassung sperrt zuverlässig die App aus.');
});
