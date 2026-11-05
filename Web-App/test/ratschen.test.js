const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const WEB = path.join(__dirname, '..');

/**
 * Ratschen: Ein gemessener Bestand darf sinken, nie steigen.
 *
 * Für Dinge, die zu zahlreich sind, um sie auf einmal aufzuräumen (stille
 * Fänge, `any`, reine Quelltext-Tests, Kommentaranteil …). Eine harte Regel
 * wäre sofort rot und bräuchte eine Ausnahmeliste, die niemand mehr liest;
 * die Ratsche gibt neuem Code den höheren Anspruch, ohne den Bestand
 * anzufassen. Wer eine Stelle aufräumt, senkt die Schranke hier.
 */

/** Alle TypeScript-Quellen ohne Tests und ohne Erzeugnisse. */
function quellen() {
  const raus = [];
  (function lauf(d) {
    for (const n of fs.readdirSync(d)) {
      const p = path.join(d, n);
      if (fs.statSync(p).isDirectory()) {
        if (['node_modules', 'dist', '.git', 'coverage', 'test'].includes(n)) continue;
        lauf(p);
      } else if (n.endsWith('.ts')) raus.push(p);
    }
  })(WEB);
  return raus;
}

const STILLE_FAENGE = [
  /catch\s*\{\s*\}/g,
  /catch\s*\(\s*\w*\s*\)\s*\{\s*\}/g,
  /\.catch\(\(\)\s*=>\s*\{\s*\}\)/g,
  // Auch ein Text, eine Zahl oder ein Objekt als Ersatz verschluckt den Fehler.
  /\.catch\(\(\)\s*=>\s*(null|undefined|true|false|-?\d+|'[^']*'|"[^"]*"|\(\{[^()]*\}\))\)/g,
  // Eine leere Liste ist für den Leser keine Fehlermeldung, sondern „nichts da".
  /\.catch\(\(\)\s*=>\s*\[\]\)/g,
];

/**
 * Treffer zaehlen — im CODE, nicht in den Erklaerungen darueber.
 *
 * ── Warum ohneKommentare() ──────────────────────────────────────────────────
 *
 * Diese Ratsche schlug an, als jemand in einem Kommentar BEGRUENDETE, warum er
 * an einer Stelle KEIN `as any` schreibt. Der Zaehler stieg um zwei, obwohl im
 * Code eines weniger stand.
 *
 * Das ist kein Randfall, sondern die Regel, die sich selbst im Weg steht: Eine
 * Ratsche, die Erklaerungen mitzaehlt, bestraft genau das Verhalten, das sie
 * erreichen will — sie macht das Aufschreiben der Begruendung teurer als das
 * stille Hinnehmen. Derselbe Fehler steckte in diesem Baum schon in
 * design-haftung, noppe-design und csv-prototyp; er faellt jedes Mal erst auf,
 * wenn jemand die Regel dokumentiert.
 */
function zaehle(muster) {
  const { ohneKommentare } = require('./helpers/sources');
  let n = 0;
  for (const f of quellen()) {
    const s = ohneKommentare(fs.readFileSync(f, 'utf8'));
    for (const m of muster) n += (s.match(m) || []).length;
  }
  return n;
}

test('die Suche findet die Quellen ueberhaupt', () => {
  // ── Der eigentliche Zweck dieser Pruefung ────────────────────────────────
  //
  // Wird ein Ordner umbenannt oder greift `quellen()` nicht mehr, zaehlen die
  // Ratschen unten NULL — und null ist kleiner als jede Schranke. Sie waeren
  // dann fuer immer gruen, ohne je wieder etwas anzusehen.
  const n = quellen().length;
  assert.ok(n >= 80, `Nur ${n} TypeScript-Quellen gefunden — greift die Suche noch?`);
});

test('stille Faenge werden weniger, nie mehr', () => {
  // Die beiden übrigen sind Rebrickable-Vermutungen, deren 404 die Antwort
  // ist; wie die Zahl gesunken ist, steht im git log.
  const SCHRANKE = 2;
  const ist = zaehle(STILLE_FAENGE);
  assert.ok(ist <= SCHRANKE,
    `${ist} stille Faenge, erlaubt sind ${SCHRANKE}. Ein neuer \`catch {}\` ` +
    'verschluckt einen Fehler und laeuft weiter — im Betrieb sieht man dann ' +
    'ein Verhalten ohne Ursache. Entweder den Fehler behandeln, oder ihn ' +
    'wenigstens melden (meldeUndWeiter aus src/infra/fehlerTexte).');
  if (ist < SCHRANKE) {
    console.log(`  ℹ stille Faenge: ${ist} (Schranke ${SCHRANKE}) — Schranke nachziehen`);
  }
});

test('any wird weniger, nie mehr', () => {
  // Gemessen 192 am 05.11.2026; wie die Zahl gesunken ist, steht im git log.
  const SCHRANKE = 192;
  const ist = zaehle([/\bas any\b/g, /:\s*any\b/g]);
  assert.ok(ist <= SCHRANKE,
    `${ist}-mal \`any\`, erlaubt sind ${SCHRANKE}. Jedes davon schaltet den ` +
    'Typpruefer fuer diesen Ausdruck ab — in einem Baum, der sonst auf ' +
    'noImplicitAny mit leerer Ausnahmeliste steht.');
  if (ist < SCHRANKE) {
    console.log(`  ℹ any: ${ist} (Schranke ${SCHRANKE}) — Schranke nachziehen`);
  }
});

test('eigene REQUIRE_DB-Blöcke in Tests werden weniger, nie mehr', () => {
  // Die Form steht in test/helpers/db.js (dbOderSkip); was davon abweicht,
  // prüft die Erreichbarkeit anders (Rollen, zweite Datenbank, Server).
  // Gemessen 117 Dateien am 05.11.2026 (vorher 296).
  // Gegenprobe (05.11.2026): den Block zurück in acquisition-all-paths-db → rot.
  const SCHRANKE = 117;
  const ist = fs.readdirSync(__dirname).filter(n => n.endsWith('.js') && n !== path.basename(__filename))
    .filter(n => fs.readFileSync(path.join(__dirname, n), 'utf8').includes('REQUIRE_DB=1, aber')).length;
  assert.ok(ist <= SCHRANKE, `${ist} Testdateien mit eigener REQUIRE_DB-Prüfung, erlaubt sind ${SCHRANKE}`);
  if (ist < SCHRANKE) console.log(`  ℹ eigene REQUIRE_DB-Prüfungen: ${ist} (Schranke ${SCHRANKE}) — Schranke nachziehen`);
});

test('Datenbankzeilen sind ohne Typargument unknown', () => {
  // Ohne Angabe war eine Zeile `any`, und die Typprüfung endete an der
  // Datenbank — dort, wo numeric und bigint als Zeichenkette ankommen.
  // Gegenprobe (05.11.2026): `get<T = any>` in DbSchnittstelle → rot.
  const quelle = fs.readFileSync(path.join(WEB, 'db', 'database.ts'), 'utf8');
  assert.equal((quelle.match(/\b(?:all|get)\s*(?::\s*)?<T = unknown>/g) || []).length, 6,
    'all/get in Schnittstelle, Pool und Transaktion');
  assert.doesNotMatch(quelle, /<T = any>|lastID/);
});

test('ungetypte Datenbankabfragen werden weniger, nie mehr', () => {
  // Erlaubt, solange niemand Felder der Zeile liest — dann verlangt der
  // Übersetzer ohnehin ein Typargument. Gemessen 92 am 05.11.2026 (vorher 190).
  // Gegenprobe (05.11.2026): Schranke auf 91 → rot.
  const SCHRANKE = 92;
  const ist = zaehle([/\b(?:db|tx|dbh|d)\.(?:get|all)\(/g]);
  assert.ok(ist <= SCHRANKE, `${ist} ungetypte db.get/all, erlaubt sind ${SCHRANKE}`);
  if (ist < SCHRANKE) console.log(`  ℹ ungetypte Abfragen: ${ist} (Schranke ${SCHRANKE}) — Schranke nachziehen`);
});

/**
 * Testdateien, die nur Quelltext lesen und nichts ausführen. Eine Regex auf
 * den Quelltext bestätigt, dass eine Zeile dasteht — nicht, dass sie wirkt
 * (der Signal-Fehler vom 25.10. stand im Quelltext, nur an der falschen
 * Stelle). Strukturprüfungen dürfen bleiben; neue Prüfungen von Verhalten
 * gehören in einen Test, der den Code laufen lässt.
 */
const LIEST_QUELLE = /readFileSync|Quelle\(|serverOnly|serverAll|i18nAll|localeSource|ohneKommentare/;
const FUEHRT_AUS = /buildAndRequire|testServer|spawn\(|spawnSync\(|execFileSync\(|fetch\(|jsdom|new Function|vm\./;
function reineQuelltextTests() {
  return fs.readdirSync(__dirname).filter(n => n.endsWith('.test.js')).filter(n => {
    const src = fs.readFileSync(path.join(__dirname, n), 'utf8');
    return LIEST_QUELLE.test(src) && !FUEHRT_AUS.test(src);
  });
}

test('reine Quelltext-Tests werden weniger, nie mehr', () => {
  // Gemessen 86 am 03.11.2026; wie die Zahl gesunken ist, steht im git log.
  const SCHRANKE = 86;
  const alle = fs.readdirSync(__dirname).filter(n => n.endsWith('.test.js')).length;
  assert.ok(alle >= 300, `Nur ${alle} Testdateien gefunden — greift die Suche noch?`);
  const ist = reineQuelltextTests();
  assert.ok(ist.length <= SCHRANKE,
    `${ist.length} Testdateien lesen nur Quelltext, erlaubt sind ${SCHRANKE}. ` +
    'Prüft der neue Test Verhalten, soll er den Code ausführen (buildAndRequire, ' +
    'testServer) statt per Regex nachzusehen, ob eine Zeile dasteht.');
  if (ist.length < SCHRANKE) {
    console.log(`  ℹ reine Quelltext-Tests: ${ist.length} (Schranke ${SCHRANKE}) — Schranke nachziehen`);
  }
});

/**
 * Emoji in der Oberfläche. Seit dem 25.10. gibt es eine Symbolfamilie (Sprite
 * in index.html); Emoji sehen je Gerät anders aus und passen weder in Grösse
 * noch Farbe dazu. Gezählt werden Markup, deutsche Sprachtexte und die
 * Vorlagen in public/js — ohne Kommentare.
 */
function emojiInDerOberflaeche() {
  const web = path.join(WEB, 'public');
  const ohne = s => s.replace(/<!--[\s\S]*?-->/g, '').replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:'"`])\/\/[^\n]*/g, '$1');
  const dateien = [path.join(web, 'index.html'), path.join(web, 'locales', 'de.js'),
    ...fs.readdirSync(path.join(web, 'js')).filter(n => /^\d\d-.*\.js$/.test(n)).map(n => path.join(web, 'js', n))];
  return dateien.reduce((n, f) => n + (ohne(fs.readFileSync(f, 'utf8')).match(/\p{Extended_Pictographic}/gu) || []).length, 0);
}

test('Emoji in der Oberfläche werden weniger, nie mehr', () => {
  // Seit dem 27.10.2026 0: Alle Stellen nutzen die Symbolfamilie oder kommen ohne aus.
  const SCHRANKE = 0;
  const ist = emojiInDerOberflaeche();
  // Selbstbeweis an einer Probe statt an der Zahl — die ist jetzt 0.
  assert.equal(('<b>📦 x</b> ⚠️').match(/\p{Extended_Pictographic}/gu)?.length, 2, 'Die Suche greift nicht mehr');
  assert.ok(ist <= SCHRANKE,
    `${ist} Emoji in der Oberfläche, erlaubt sind ${SCHRANKE}. Für Symbole gibt es ` +
    'die Symbolfamilie: <svg class="ico" aria-hidden="true"><use href="#i-…"/></svg>.');
  if (ist < SCHRANKE) console.log(`  ℹ Emoji: ${ist} (Schranke ${SCHRANKE}) — Schranke nachziehen`);
});

/**
 * Inline-Stile in index.html. Ein data-stil="…" (js/00-stile.js setzt es als
 * Inline-Stil) setzt sich über jedes Design und jede Telefonregel hinweg;
 * gleiche Dinge sahen deshalb an zwei Stellen verschieden aus. Gezählt werden
 * Attribute ausserhalb von Kommentaren. display:none bleibt erlaubt: Die
 * Skripte schalten es um.
 */
test('Inline-Stile in index.html werden weniger, nie mehr', () => {
  // GEMESSEN am 28.10.2026: 455 vor dem Umzug in Klassen, danach 170,
  // davon 56 reines display:none. 112 am 29.10. (Merkliste-Kasten als Klasse),
  // 52 am selben Tag (Diagramm, Banner, Dialogfüsse, PDF-Ansicht als Klassen).
  // 51 am 30.10. (Kennzahlen der Minifiguren ohne eigenes Raster). 47 am 03.11.
  // 38 am 04.11. (Bauliste und Zwischenspeicher als Klassen); 36 am selben Tag (Bauliste-Chips und Status).
  const SCHRANKE = 36;
  const html = fs.readFileSync(path.join(WEB, 'public', 'index.html'), 'utf8').replace(/<!--[\s\S]*?-->/g, '');
  const stile = [...html.matchAll(/<[a-zA-Z][^>]*?\sdata-stil="([^"]*)"/g)].map(m => m[1].trim().replace(/;$/, ''));
  assert.ok(stile.length > 50, 'Keine Inline-Stile gefunden — greift die Suche noch?');
  const ist = stile.filter(s => s !== 'display:none').length;
  assert.ok(ist <= SCHRANKE,
    `${ist} Inline-Stile (ohne display:none) in index.html, erlaubt sind ${SCHRANKE}. ` +
    'Gestaltung gehört in styles.css; dort sieht sie jedes Design und mobile.css.');
  if (ist < SCHRANKE) console.log(`  ℹ Inline-Stile: ${ist} (Schranke ${SCHRANKE}) — Schranke nachziehen`);
});

/** Quelltext von Server und Oberfläche — für die beiden Kommentar-Ratschen unten. */
function serverUndOberflaeche() {
  const js = path.join(WEB, 'public', 'js');
  return [...quellen(), ...fs.readdirSync(js).filter(f => /^\d\d-.*\.js$/.test(f)).map(f => path.join(js, f)),
          path.join(WEB, 'public', 'i18n.js')];
}

test('kein Verweis auf „Nachtrag N" im Code', () => {
  // Die Geschichte einer Stelle steht im Commit (CLAUDE.md); eine Nummer im
  // Kommentar verweist auf eine Liste, die es im Baum nicht gibt.
  // Gegenprobe: ein „(Nachtrag 1)" in src/konto/auth.ts → rot.
  const treffer = serverUndOberflaeche().flatMap(f =>
    (fs.readFileSync(f, 'utf8').match(/Nachtr(?:ag|äge|aege) \d+/g) || []).map(m => `${path.relative(WEB, f)}: ${m}`));
  assert.deepEqual(treffer, []);
});

test('kein Modul wird in einer Datei zweimal importiert', () => {
  // Je Modul ein Wert-Import und höchstens ein `import type`; neun Zeilen für
  // neun Namen aus derselben Datei verdecken, was wirklich gebraucht wird.
  // Gegenprobe (05.11.2026): `import { fehlertext } from '../infra/fehler';`
  // zusätzlich in src/finanzen/preisalarm.ts → rot.
  const treffer = [];
  for (const f of quellen()) {
    const gesehen = new Set();
    for (const m of fs.readFileSync(f, 'utf8').matchAll(/^import\s+(type\s+)?[^;]*?from\s*'([^']+)';/gm)) {
      const k = `${m[1] ? 'type ' : ''}${m[2]}`;
      if (gesehen.has(k)) treffer.push(`${path.relative(WEB, f)}: ${k}`);
      gesehen.add(k);
    }
  }
  assert.deepEqual(treffer, []);
});

test('der Kommentaranteil im Server sinkt, nie steigt', () => {
  // Gemessen 13,8 % in server.ts, routes/, src/ und jobs/; 13,2 % mit dem
  // API-Vertrag (src/infra/vertrag/). Schranke 13,2.
  const SCHRANKE = 13.2;
  let zeilen = 0, kommentar = 0;
  for (const f of quellen().filter(f => /[\\/](routes|src|jobs)[\\/]|[\\/]server\.ts$/.test(f))) {
    for (const z of fs.readFileSync(f, 'utf8').split('\n')) {
      const t = z.trim();
      if (!t) continue;
      zeilen++;
      if (t.startsWith('//') || t.startsWith('*') || t.startsWith('/*')) kommentar++;
    }
  }
  assert.ok(zeilen > 10000, `nur ${zeilen} Zeilen gefunden — greift die Suche noch?`);
  const anteil = Math.round(1000 * kommentar / zeilen) / 10;
  assert.ok(anteil <= SCHRANKE, `${anteil} % Kommentarzeilen, erlaubt sind ${SCHRANKE} %`);
  if (anteil < SCHRANKE - 0.5) console.log(`  ℹ Kommentaranteil: ${anteil} % (Schranke ${SCHRANKE}) — Schranke nachziehen`);
});

/** Quellen der Oberfläche: public/js ohne Bündel, dazu i18n.js. */
function oberflaeche() {
  const js = path.join(WEB, 'public', 'js');
  return [...fs.readdirSync(js).filter(f => f.endsWith('.js') && f !== 'app.bundle.js').map(f => path.join(js, f)),
          path.join(WEB, 'public', 'i18n.js')];
}

test('der Kommentaranteil der Oberfläche sinkt, nie steigt', () => {
  // Gemessen am 05.11.2026: 35,9 %; nach dem Auslagern der langen Kommentare
  // nach docs/begruendungen/public/ 26,1 %. Gegenprobe: 300 Kommentarzeilen
  // an 01-core.js gehängt → rot.
  const SCHRANKE = 26.1;
  let zeilen = 0, kommentar = 0;
  for (const f of oberflaeche()) {
    for (const z of fs.readFileSync(f, 'utf8').split('\n')) {
      const t = z.trim();
      if (!t) continue;
      zeilen++;
      if (t.startsWith('//') || t.startsWith('*') || t.startsWith('/*')) kommentar++;
    }
  }
  assert.ok(zeilen > 8000, `nur ${zeilen} Zeilen gefunden — greift die Suche noch?`);
  const anteil = Math.round(1000 * kommentar / zeilen) / 10;
  assert.ok(anteil <= SCHRANKE, `${anteil} % Kommentarzeilen in der Oberfläche, erlaubt sind ${SCHRANKE} %`);
  if (anteil < SCHRANKE - 0.5) console.log(`  ℹ Kommentaranteil Oberfläche: ${anteil} % (Schranke ${SCHRANKE}) — Schranke nachziehen`);
});

test('kein Kommentar der Oberfläche hat mehr als fünf Zeilen Prosa', () => {
  // CLAUDE.md: Ein Kommentar sagt in zwei bis fünf Zeilen, warum. JSDoc-Tags
  // (@param, @returns …) zählen nicht mit. Gemessen am 05.11.2026: 206 Blöcke,
  // ausgelagert nach docs/begruendungen/public/; seitdem 0.
  // Gegenprobe: ein //-Block mit sechs Zeilen in 01-core.js → rot mit Fundstelle.
  const lang = [];
  let bloecke = 0;
  for (const f of oberflaeche()) {
    const z = fs.readFileSync(f, 'utf8').split('\n');
    for (let i = 0; i < z.length; i++) {
      const t = z[i].trim();
      let prosa = null, j = i;
      if (t.startsWith('//')) {
        while (j + 1 < z.length && z[j + 1].trim().startsWith('//')) j++;
        prosa = z.slice(i, j + 1).map(l => l.trim().replace(/^\/\/ ?/, ''));
      } else if (t.startsWith('/*') && !t.includes('*/')) {
        while (j + 1 < z.length && !z[j].includes('*/')) j++;
        const innen = [t.replace(/^\/\*\*?/, ''), ...z.slice(i + 1, j).map(l => l.trim().replace(/^\* ?/, ''))];
        const k = innen.findIndex(l => l.trim().startsWith('@'));
        prosa = k < 0 ? innen : innen.slice(0, k);
      }
      if (!prosa) continue;
      bloecke++;
      if (prosa.filter(l => l.trim()).length > 5) lang.push(`${path.relative(WEB, f)}:${i + 1}`);
      i = j;
    }
  }
  assert.ok(bloecke > 300, `nur ${bloecke} Kommentarblöcke gefunden — greift die Suche noch?`);
  assert.deepEqual(lang, [], 'Lange Begründung: Warum in den Code (höchstens fünf Zeilen), Geschichte in den Commit');
});

/** Funktionen der Oberfläche mit ihrer Länge (Deklaration bis zur schliessenden Klammer gleicher Einrückung). */
function funktionsLaengen() {
  const raus = [];
  for (const f of oberflaeche()) {
    const z = fs.readFileSync(f, 'utf8').split('\n');
    z.forEach((l, i) => {
      const m = l.match(/^(\s*)(?:export\s+)?(?:async\s+)?function\s*\*?\s*(\w+)\s*\(/);
      if (!m || /\}\s*;?\s*$/.test(l)) return;
      const ende = z.findIndex((x, j) => j > i && x.startsWith(m[1] + '}'));
      if (ende > i) raus.push({ ort: `${path.relative(WEB, f)}:${i + 1} ${m[2]}`, zeilen: ende - i + 1 });
    });
  }
  return raus;
}

test('keine Funktion der Oberfläche über 100 Zeilen, über 80 werden weniger', () => {
  // Gemessen am 05.11.2026: 13 über 100 (loadFinance 262); nach dem Aufteilen
  // 0 über 100 und 8 über 80. Gegenprobe: loadFinance wieder in einem Stück
  // (vor dem Aufteilen) → rot mit „04-finance.js … loadFinance“.
  const SCHRANKE_80 = 8;
  const alle = funktionsLaengen();
  assert.ok(alle.length > 500, `nur ${alle.length} Funktionen gefunden — greift die Suche noch?`);
  const ueber100 = alle.filter(x => x.zeilen > 100).map(x => `${x.ort} (${x.zeilen})`);
  assert.deepEqual(ueber100, [], 'Eine Funktion über 100 Zeilen: in benannte Teile zerlegen');
  const ueber80 = alle.filter(x => x.zeilen > 80);
  assert.ok(ueber80.length <= SCHRANKE_80,
    `${ueber80.length} Funktionen über 80 Zeilen, erlaubt sind ${SCHRANKE_80}:\n${ueber80.map(x => x.ort).join('\n')}`);
  if (ueber80.length < SCHRANKE_80) console.log(`  ℹ Funktionen über 80 Zeilen: ${ueber80.length} (Schranke ${SCHRANKE_80}) — Schranke nachziehen`);
});

test('der Kommentaranteil in db/, clients/ und scripts/ sinkt, nie steigt', () => {
  // Je Ordner eine Schranke, gemessen am 05.11.2026 nach dem Kürzen.
  // Gegenprobe: 40 Kommentarzeilen an clients/ezb.ts gehängt → rot (clients).
  const SCHRANKE = { db: 33.0, clients: 20.6, scripts: 35.2 };
  const zuViel = [];
  for (const [ordner, schranke] of Object.entries(SCHRANKE)) {
    let zeilen = 0, kommentar = 0;
    (function lauf(d) {
      for (const n of fs.readdirSync(d)) {
        const p = path.join(d, n);
        if (fs.statSync(p).isDirectory()) { if (n !== 'node_modules') lauf(p); continue; }
        if (!/\.(ts|js|sh)$/.test(n) || (n.endsWith('.js') && fs.existsSync(p.slice(0, -3) + '.ts'))) continue;
        for (const z of fs.readFileSync(p, 'utf8').split('\n')) {
          const t = z.trim();
          if (!t) continue;
          zeilen++;
          if (t.startsWith('//') || t.startsWith('*') || t.startsWith('/*') || (n.endsWith('.sh') && t.startsWith('#'))) kommentar++;
        }
      }
    })(path.join(WEB, ordner));
    assert.ok(zeilen > 500, `${ordner}: nur ${zeilen} Zeilen gefunden — greift die Suche noch?`);
    const anteil = Math.round(1000 * kommentar / zeilen) / 10;
    if (anteil > schranke) zuViel.push(`${ordner}: ${anteil} % (erlaubt ${schranke} %)`);
    else if (anteil < schranke - 0.5) console.log(`  ℹ Kommentaranteil ${ordner}: ${anteil} % (Schranke ${schranke}) — Schranke nachziehen`);
  }
  assert.deepEqual(zuViel, []);
});

test('der Kommentaranteil der Tests sinkt, nie steigt', () => {
  // Eigene Schranke: Testköpfe zählen ihre Gegenproben auf (CLAUDE.md), der
  // Anteil liegt deshalb höher als im Server. Geschichte gehört auch hier in
  // den Commit. Gemessen 33,3 % in test/*.js und test/helpers/ (05.11.2026); Schranke 33,4.
  // Gegenprobe: 300 Kommentarzeilen an eine Testdatei gehängt → rot.
  const SCHRANKE = 33.4;
  const dateien = [
    ...fs.readdirSync(__dirname).filter(n => n.endsWith('.js')).map(n => path.join(__dirname, n)),
    ...fs.readdirSync(path.join(__dirname, 'helpers')).filter(n => n.endsWith('.js')).map(n => path.join(__dirname, 'helpers', n)),
  ];
  let zeilen = 0, kommentar = 0;
  for (const f of dateien) {
    for (const z of fs.readFileSync(f, 'utf8').split('\n')) {
      const t = z.trim();
      if (!t) continue;
      zeilen++;
      if (t.startsWith('//') || t.startsWith('*') || t.startsWith('/*')) kommentar++;
    }
  }
  assert.ok(zeilen > 20000, `nur ${zeilen} Zeilen gefunden — greift die Suche noch?`);
  const anteil = Math.round(1000 * kommentar / zeilen) / 10;
  assert.ok(anteil <= SCHRANKE, `${anteil} % Kommentarzeilen in den Tests, erlaubt sind ${SCHRANKE} %`);
  if (anteil < SCHRANKE - 0.5) console.log(`  ℹ Kommentaranteil Tests: ${anteil} % (Schranke ${SCHRANKE}) — Schranke nachziehen`);
});

test('jeder Verweis auf docs/begruendungen trifft Datei und Anker', () => {
  // Die langen Begründungen liegen in docs/begruendungen/<datei>.md; der Code
  // verweist mit „Ausführlich: …#anker". Beim Verschieben einer Datei wandert
  // das Dokument mit — dieser Test hält Verweis und Ziel zusammen.
  // Gegenprobe (31.10.2026): #post-tokens statt #get-tokens in
  // routes/api_v1/settings.ts → rot.
  const kaputt = [];
  let n = 0;
  for (const f of serverUndOberflaeche()) {
    for (const m of fs.readFileSync(f, 'utf8').matchAll(/docs\/begruendungen\/([^\s#`'"]+\.md)#([\w-]+)/g)) {
      n++;
      const doc = path.join(WEB, 'docs', 'begruendungen', m[1]);
      if (!fs.existsSync(doc)) { kaputt.push(`${path.relative(WEB, f)}: ${m[1]} fehlt`); continue; }
      if (!fs.readFileSync(doc, 'utf8').includes(`<a id="${m[2]}"></a>`)) kaputt.push(`${path.relative(WEB, f)}: ${m[1]}#${m[2]}`);
    }
  }
  assert.ok(n > 200, `nur ${n} Verweise gefunden — greift die Suche noch?`);
  assert.deepEqual(kaputt, []);
});

test('jedes Dokument unter docs/begruendungen wird vom Code erreicht', () => {
  // Ein Dokument ohne Verweis ist Geschichte und gehört nach git, nicht in
  // den Baum; eines, dessen Code umgezogen ist, zieht mit (Dateiname = Ort).
  // Gegenprobe: docs/begruendungen/src/verwaist.ts.md angelegt → rot
  // („src/verwaist.ts.md" in der Liste der unerreichten Dokumente).
  const verwiesen = new Set();
  for (const f of serverUndOberflaeche()) {
    for (const m of fs.readFileSync(f, 'utf8').matchAll(/docs\/begruendungen\/([^\s#`'"]+\.md)#/g)) verwiesen.add(m[1]);
  }
  const wurzel = path.join(WEB, 'docs', 'begruendungen');
  const dokumente = [];
  (function lauf(d) {
    for (const n of fs.readdirSync(d)) {
      const p = path.join(d, n);
      if (fs.statSync(p).isDirectory()) lauf(p);
      else dokumente.push(path.relative(wurzel, p).split(path.sep).join('/'));
    }
  })(wurzel);
  assert.ok(dokumente.length > 50, `nur ${dokumente.length} Dokumente gefunden — greift die Suche noch?`);
  assert.deepEqual(dokumente.filter(d => !verwiesen.has(d)), []);
});

test('der Kommentaranteil der Betriebsdateien sinkt, nie steigt', () => {
  // Workflows, Dockerfile, compose.yaml, tsconfig.json: Auch dort steht das
  // Warum in wenigen Zeilen, die Geschichte im Commit (CLAUDE.md). Gemessen
  // am 04.11.2026: 24,5 % (vorher 44,0 %). Das Caddyfile zählt nicht mit:
  // Kein Block darin ist länger als fünf Zeilen.
  // Gegenprobe (04.11.2026): 60 Kommentarzeilen an das Dockerfile → rot.
  const SCHRANKE = 24.5;
  const wf = path.join(WEB, '..', '.github', 'workflows');
  const dateien = [
    ...fs.readdirSync(wf).filter(f => /\.ya?ml$/.test(f)).map(f => path.join(wf, f)),
    ...['Dockerfile', 'compose.yaml', 'tsconfig.json'].map(f => path.join(WEB, f)),
  ];
  let zeilen = 0, kommentar = 0;
  for (const f of dateien) {
    for (const z of fs.readFileSync(f, 'utf8').split('\n')) {
      const t = z.trim();
      if (!t) continue;
      zeilen++;
      if (t.startsWith('#') || t.startsWith('//')) kommentar++;
    }
  }
  assert.ok(dateien.length >= 6 && zeilen > 1000, `nur ${dateien.length} Dateien, ${zeilen} Zeilen — greift die Suche noch?`);
  const anteil = Math.round(1000 * kommentar / zeilen) / 10;
  assert.ok(anteil <= SCHRANKE, `${anteil} % Kommentarzeilen in den Betriebsdateien, erlaubt sind ${SCHRANKE} %`);
  if (anteil < SCHRANKE - 0.5) console.log(`  ℹ Kommentaranteil Betrieb: ${anteil} % (Schranke ${SCHRANKE}) — Schranke nachziehen`);
});
