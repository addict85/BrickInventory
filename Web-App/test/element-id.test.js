/**
 * Jede id, die das Skript nachschlägt, gibt es auch.
 *
 * ── Der Befund ──────────────────────────────────────────────────────────────
 *
 * `G(id)` ist `document.getElementById(id)` (public/js/01-core.js). Für eine
 * id, die es nicht gibt, kommt `null` zurück — und weil fast jede Fundstelle
 * mit `if (el)` oder `?.` abgesichert ist, KRACHT ES NICHT. Die Zeile tut
 * einfach nichts. Genau darum fällt so etwas nie auf.
 *
 * NACHGEMESSEN schlug das Skript 304 verschiedene ids nach; 342 stehen in
 * index.html, 31 legt das Skript selbst an. Genau EINE fehlte:
 *
 *     05-settings.js, Profil speichern:
 *       if (ME) { ME.username = username; const uel = G('uname'); … }
 *
 * Der Namenszug in der Kopfzeile heisst `ubadge` (index.html), und gesetzt
 * wird er sonst nur ein einziges Mal — in `showApp()` beim Anmelden. Wer
 * seinen Benutzernamen änderte, sah oben rechts bis zum nächsten Neuladen
 * weiter den alten. `loadProfile()` direkt darüber füllt nur die Felder des
 * Formulars, nicht die Kopfzeile.
 *
 * ── Was als „gibt es" zählt ─────────────────────────────────────────────────
 *
 *   id="…" in index.html          statisch im Seitenquelltext
 *   id="…" in einer Vorlage       das Skript baut das Element als HTML
 *   el.id = '…'                   das Skript setzt die id am Element
 *   wertId: '…'                   01-bausteine.js macht daraus ein id="…"
 *
 * Die beiden letzten Formen sind der Grund, warum diese Messung beim ersten
 * Lauf FÜNF Treffer meldete statt einem: `app-scrollbar` (15-scrollbar.js)
 * und die drei Werte aus `detailZeile(…, { wertId })` entstehen zur Laufzeit
 * und stehen nirgends als `id="…"` da. Vier Fehlalarme hätten die Prüfung
 * wertlos gemacht — deshalb kennt sie alle vier Formen.
 *
 * Ein fünfter Fehlalarm kam aus einem KOMMENTAR: 06-minifigs.js hält fest,
 * dass dort einmal `G('fig-source')` stand. Kommentare werden vorher
 * entfernt — dieselbe Falle, vor der test/helpers/sources.js warnt.
 *
 * ── Was der Test NICHT kann ─────────────────────────────────────────────────
 *
 * Zusammengesetzte ids (`G('tab-' + name)`) sieht er nicht; sie tragen keinen
 * festen Namen. Er sieht auch nicht, ob das Element zum Zeitpunkt des
 * Zugriffs schon da ist. Er beantwortet nur die eine Frage, die hier falsch
 * beantwortet war: Kann diese id überhaupt jemals existieren?
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');

/** Alle Skriptdateien der Oberfläche — ohne Kommentare, ohne das Bündel. */
function skripte() {
  const out = [];
  const lauf = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) { if (!/node_modules|locales/.test(p)) lauf(p); continue; }
      if (!/\.js$/.test(e.name) || e.name === 'app.bundle.js') continue;
      out.push([path.relative(ROOT, p),
        fs.readFileSync(p, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')]);
    }
  };
  lauf(path.join(ROOT, 'public'));
  return out;
}

const ID_ATTR = /\bid="([A-Za-z][\w:-]*)"/g;
const ID_ZUWEISUNG = /\.id\s*=\s*['"]([A-Za-z][\w:-]*)['"]/g;
const ID_WERTID = /\bwertId:\s*['"]([A-Za-z][\w:-]*)['"]/g;
const NACHSCHLAG = /\bG\(\s*['"]([A-Za-z][\w:-]*)['"]\s*\)|getElementById\(\s*['"]([A-Za-z][\w:-]*)['"]\s*\)/g;

test('jede nachgeschlagene Element-id gibt es auch', () => {
  const html = fs.readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8');
  const vorhanden = new Set([...html.matchAll(ID_ATTR)].map(m => m[1]));
  // Selbstbeweis: Greift das Muster nicht mehr, wäre alles „fehlend" —
  // oder, bei umgekehrtem Fehler, alles „vorhanden". GEMESSEN sind es 342.
  assert.ok(vorhanden.size >= 250,
    `Nur ${vorhanden.size} ids in index.html gefunden — Muster veraltet?`);

  const dateien = skripte();
  assert.ok(dateien.length >= 15, `Nur ${dateien.length} Skriptdateien gefunden`);

  let erzeugt = 0;
  for (const [, src] of dateien)
    for (const muster of [ID_ATTR, ID_WERTID, ID_ZUWEISUNG])
      for (const m of src.matchAll(muster)) { vorhanden.add(m[1]); erzeugt++; }
  // GEMESSEN legt das Skript 31 ids selbst an. Ohne diese Formen meldete die
  // Prüfung vier Fehlalarme — siehe Kopf.
  assert.ok(erzeugt >= 10, `Nur ${erzeugt} zur Laufzeit erzeugte ids — Muster veraltet?`);

  const nachgeschlagen = new Map();
  for (const [rel, src] of dateien)
    for (const m of src.matchAll(NACHSCHLAG)) {
      const k = m[1] || m[2];
      if (!nachgeschlagen.has(k)) nachgeschlagen.set(k, rel);
    }
  // GEMESSEN sind es 304 verschiedene ids.
  assert.ok(nachgeschlagen.size >= 200,
    `Nur ${nachgeschlagen.size} Nachschlagestellen gefunden — Muster veraltet?`);

  const fehlend = [...nachgeschlagen]
    .filter(([k]) => !vorhanden.has(k))
    .map(([k, rel]) => `${k}   (${rel})`)
    .sort();
  assert.deepEqual(fehlend, [],
    'Diese ids schlägt das Skript nach, aber es gibt sie nirgends:\n  ' +
    fehlend.join('\n  ') +
    '\ngetElementById gibt dann null zurück; wegen der üblichen `if (el)`-' +
    'Absicherung tut die Zeile schlicht nichts — ohne Fehlermeldung.');
});
