/**
 * Der Zwischendialog beim Erfassen eines Sets zeigt nur Schritte, auf die der
 * Browser tatsächlich wartet.
 *
 * ── Fehlerbild ──────────────────────────────────────────────────────────────
 * Der Dialog listete sechs Punkte: Set-Informationen, Bild, Anleitungen, Teile,
 * Teilbilder, Preis. Vier davon waren zu dem Zeitpunkt längst tot:
 *
 *   • 'parts_start', 'parts_importing', 'parts_done', 'parts_images' und
 *     'parts_error' kamen aus importPartsForSet(). Seit der Teile-Import aus
 *     addSet() heraus in ein setTimeout gewandert ist, übergab JEDE Aufruf-
 *     stelle `null` als Fortschritts-Melder — die Ereignisse konnten den
 *     Browser gar nicht mehr erreichen.
 *   • 'instructions' wurde zwar noch gesendet, der Download lief aber schon in
 *     einem setImmediate(). Der Punkt sprang auf „aktiv" und blieb dort stehen.
 *   • 'price' wurde von KEINER Serverstelle je gesendet.
 *
 * Der Dialog behauptete also Arbeit, auf die niemand wartete. Nach aussen sah
 * das aus wie ein hängender Import.
 *
 * ── Was dieser Test festhält ────────────────────────────────────────────────
 * Die beiden Richtungen der Kopplung zwischen Server und Dialog:
 *
 *   1. Jeder `case` in handleSseEvent() muss von einer Serverstelle gesendet
 *      werden, deren Melder mindestens ein Aufrufer NICHT als `null` übergibt.
 *      Das ist die Richtung, die den Fehler oben verhindert hätte.
 *   2. Jede `ps-…`-Kennung, die das Frontend anspricht, muss es in index.html
 *      geben — sonst schreibt setStep() ins Leere.
 *
 * Bewusst NICHT geprüft wird die Gegenrichtung „jeder gesendete Schritt hat
 * einen case": 'done_meta' hatte jahrelang keinen, und der Server darf mehr
 * melden, als der Dialog zeigt.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { ROOT, ohneKommentare } = require('./helpers/sources');

/** Alle Server-Quellen, die Fortschritt melden könnten. */
function serverQuellen() {
  const dirs = ['utils', 'routes', 'jobs', 'clients'];
  const out = [];
  const lauf = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) lauf(p);
      else if (e.name.endsWith('.ts')) out.push([path.relative(ROOT, p), ohneKommentare(fs.readFileSync(p, 'utf8'))]);
    }
  };
  for (const d of dirs) lauf(path.join(ROOT, d));
  return out;
}

/**
 * Zerlegt eine Argumentliste an den Kommas der OBERSTEN Ebene.
 *
 * Nötig, weil Aufrufe wie `addSet(a, b, c, d=>{ … ; send(d); }, e, f)` mitten
 * im vierten Argument Kommas enthalten. Ein blosses split(',') würde den
 * Fortschritts-Melder an der falschen Stelle suchen.
 */
function argumente(text) {
  const teile = [];
  let tiefe = 0, akt = '', str = null;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (str) { if (c === str && text[i - 1] !== '\\') str = null; akt += c; continue; }
    if (c === '"' || c === "'" || c === '`') { str = c; akt += c; continue; }
    if ('([{'.includes(c)) tiefe++;
    if (')]}'.includes(c)) tiefe--;
    if (c === ',' && tiefe === 0) { teile.push(akt.trim()); akt = ''; continue; }
    akt += c;
  }
  if (akt.trim()) teile.push(akt.trim());
  return teile;
}

/** Schneidet ab `start` die Klammer-Inhalte des Aufrufs heraus. */
function klammerInhalt(src, start) {
  let tiefe = 0, str = null;
  for (let i = start; i < src.length; i++) {
    const c = src[i];
    if (str) { if (c === str && src[i - 1] !== '\\') str = null; continue; }
    if (c === '"' || c === "'" || c === '`') { str = c; continue; }
    if (c === '(') tiefe++;
    else if (c === ')') { tiefe--; if (tiefe === 0) return src.slice(start + 1, i); }
  }
  return null;
}

/**
 * Schritte, die den Browser erreichen können.
 *
 * Vorgehen: Für jede Funktion mit einem `sendProgress`-Parameter wird die
 * Position dieses Parameters bestimmt und geprüft, ob irgendein Aufrufer dort
 * etwas anderes als `null` übergibt. Nur dann zählen die Schritt-Namen, die im
 * Rumpf dieser Funktion gemeldet werden, als erreichbar.
 */
function erreichbareSchritte() {
  const quellen = serverQuellen();
  const alles = quellen.map(([, s]) => s).join('\n');
  const erreichbar = new Set();

  // Schritte, die eine Route direkt in ihren eigenen Strom schreibt, sind immer
  // erreichbar — dort gibt es keinen durchgereichten Melder.
  for (const m of alles.matchAll(/\bsend\(\{\s*step\s*:\s*'([^']+)'/g)) erreichbar.add(m[1]);

  for (const [datei, src] of quellen) {
    for (const m of src.matchAll(/(?:async\s+)?function\s+(\w+)\s*\(/g)) {
      const name = m[1];
      const params = klammerInhalt(src, m.index + m[0].length - 1);
      if (params === null || !/\bsendProgress\b/.test(params)) continue;
      const idx = argumente(params).findIndex((a) => /^sendProgress\b/.test(a));
      assert.notEqual(idx, -1, `${datei}: sendProgress-Parameter von ${name} nicht gefunden`);

      // Meldet diese Funktion überhaupt Schritte?
      const rumpf = klammerInhalt(src, src.indexOf('{', m.index + m[0].length) ) ?? '';
      const gemeldet = [...src.slice(m.index).matchAll(/sendProgress\(\{\s*step\s*:\s*'([^']+)'/g)]
        .map((x) => x[1]);
      if (!gemeldet.length) continue;

      // Übergibt irgendein Aufrufer etwas anderes als null?
      let lebt = false;
      for (const [, s2] of quellen) {
        for (const c of s2.matchAll(new RegExp(`\\b${name}\\s*\\(`, 'g'))) {
          if (/function\s*$/.test(s2.slice(0, c.index))) continue; // die Deklaration selbst
          const args = klammerInhalt(s2, c.index + c[0].length - 1);
          if (args === null) continue;
          const a = argumente(args)[idx];
          if (a !== undefined && a !== 'null') { lebt = true; break; }
        }
        if (lebt) break;
      }
      if (lebt) for (const g of gemeldet) erreichbar.add(g);
      void rumpf;
    }
  }
  return erreichbar;
}

const galerie = fs.readFileSync(path.join(ROOT, 'public', 'js', '02-gallery.js'), 'utf8');
const html = fs.readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8');

test('jeder Schritt im Fortschrittsdialog kann den Browser auch erreichen', () => {
  const schalter = galerie.slice(galerie.indexOf('export function handleSseEvent'));
  const rumpf = schalter.slice(0, schalter.indexOf('\n}\n'));
  const faelle = [...rumpf.matchAll(/case\s+'([^']+)'/g)].map((m) => m[1]);
  assert.ok(faelle.length >= 3, `handleSseEvent hat nur ${faelle.length} Fälle — Anker stimmt nicht mehr`);

  const erreichbar = erreichbareSchritte();
  assert.ok(erreichbar.size >= 4, `nur ${erreichbar.size} erreichbare Schritte gefunden — Anker stimmt nicht mehr`);

  const tot = faelle.filter((f) => !erreichbar.has(f));
  assert.deepEqual(tot, [],
    `Der Dialog behandelt Schritte, die keine Serverstelle mehr sendet: ${tot.join(', ')}. ` +
    'Entweder sendet der Server sie wieder, oder der Fall gehört aus handleSseEvent entfernt.');
});

test('jede angesprochene ps-Kennung gibt es auch im Dialog', () => {
  const ids = new Set([...galerie.matchAll(/'ps-([a-z-]+)'/g)].map((m) => 'ps-' + m[1]));
  // setStep() setzt die Kennung aus 'ps-' + Name zusammen; beide Formen einsammeln.
  for (const m of galerie.matchAll(/setStep\('([a-z-]+)'/g)) ids.add('ps-' + m[1]);
  assert.ok(ids.size >= 2, `nur ${ids.size} ps-Kennungen gefunden — Anker stimmt nicht mehr`);

  const fehlend = [...ids].filter((id) => !html.includes(`id="${id}"`));
  assert.deepEqual(fehlend, [],
    `Frontend spricht Elemente an, die es in index.html nicht gibt: ${fehlend.join(', ')}`);
});

test('kein Sprachschlüssel für die entfernten Schritte bleibt zurück', () => {
  for (const datei of ['de.js', 'en.js']) {
    const s = fs.readFileSync(path.join(ROOT, 'public', 'locales', datei), 'utf8');
    for (const key of ['prog.step_instr', 'prog.step_parts', 'prog.step_partimgs', 'prog.step_price']) {
      assert.ok(!s.includes(`'${key}'`), `${datei}: ${key} gehört zu einem entfernten Schritt`);
    }
    assert.ok(s.includes("'prog.hint_background'"), `${datei}: Hinweis auf die Hintergrundarbeit fehlt`);
  }
});

/**
 * Spielt den Ablauf einmal durch, statt nur Muster zu suchen.
 *
 * Der eigentliche Fehler war ja nicht „ein Fall zu viel", sondern: ein Punkt
 * sprang auf „aktiv" und wurde nie fertig, weil das abschliessende Ereignis
 * ausblieb. Genau das fällt einer Mustersuche nicht auf — hier fällt es auf,
 * weil die Sendereihenfolge des Servers auf die Schaltlogik des Dialogs
 * angewendet wird und am Ende kein Punkt mehr „aktiv" stehen darf.
 */
test('nach dem letzten Ereignis hängt kein Punkt mehr auf „aktiv"', () => {
  // ── Sendereihenfolge, wie addSet() sie erzeugt ───────────────────────────
  const dienst = ohneKommentare(fs.readFileSync(path.join(ROOT, 'utils', 'setService.ts'), 'utf8'));
  const beginn = dienst.indexOf('async function addSet(');
  assert.notEqual(beginn, -1, 'addSet() nicht gefunden — Anker stimmt nicht mehr');
  const folge = [...dienst.slice(beginn).matchAll(/sendProgress\(\{\s*step\s*:\s*'([^']+)'/g)]
    .map((m) => m[1]);
  assert.ok(folge.length >= 2, `addSet() meldet nur ${folge.length} Schritte — Anker stimmt nicht mehr`);
  folge.push('done'); // routes/sets.ts schliesst den Strom damit ab

  // ── Schaltlogik, wie handleSseEvent() sie ausführt ───────────────────────
  const schalter = galerie.slice(galerie.indexOf('export function handleSseEvent'));
  const rumpf = schalter.slice(0, schalter.indexOf('\n}\n'));
  const wirkung = {};
  for (const zeile of rumpf.split('\n')) {
    const c = zeile.match(/case\s+'([^']+)'\s*:/);
    if (!c) continue;
    wirkung[c[1]] = [...zeile.matchAll(/setStep\('([a-z-]+)'\s*,\s*'(\w+)'\)/g)]
      .map((m) => [m[1], m[2]]);
  }

  // ── Durchspielen ─────────────────────────────────────────────────────────
  const zustand = {};
  for (const ereignis of folge) {
    for (const [punkt, wert] of wirkung[ereignis] || []) zustand[punkt] = wert;
  }

  const haengt = Object.entries(zustand).filter(([, w]) => w === 'active').map(([k]) => k);
  assert.deepEqual(haengt, [],
    `Diese Punkte bleiben am Ende auf „aktiv" hängen: ${haengt.join(', ')}. ` +
    'Entweder sendet der Server ein abschliessendes Ereignis dafür, oder der ' +
    'Punkt gehört nicht in den Dialog — er zeigt sonst dauerhaft Arbeit an, ' +
    'auf die niemand wartet.');

  // Und jeder Punkt, den es im Dialog GIBT, muss der Ablauf auch erreichen.
  const gezeigt = [...html.matchAll(/class="prog-step" id="ps-([a-z-]+)"/g)].map((m) => m[1]);
  assert.ok(gezeigt.length >= 2, `nur ${gezeigt.length} Punkte im Dialog — Anker stimmt nicht mehr`);
  const nieBeruehrt = gezeigt.filter((g) => !(g in zustand));
  assert.deepEqual(nieBeruehrt, [],
    `Diese Punkte stehen im Dialog, werden aber nie geschaltet: ${nieBeruehrt.join(', ')}`);
});
