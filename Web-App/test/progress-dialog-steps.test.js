/**
 * Der Zwischendialog beim Erfassen eines Sets zeigt nur Schritte, auf die der
 * Browser tatsächlich wartet.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { ROOT, ohneKommentare } = require('./helpers/sources');

/** Alle Server-Quellen, die Fortschritt melden könnten. */
function serverQuellen() {
  const dirs = ['src', 'routes', 'jobs', 'clients'];
  const out = [];
  const lauf = d => {
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
  let tiefe = 0,
    akt = '',
    str = null;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (str) {
      if (c === str && text[i - 1] !== '\\') str = null;
      akt += c;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') {
      str = c;
      akt += c;
      continue;
    }
    if ('([{'.includes(c)) tiefe++;
    if (')]}'.includes(c)) tiefe--;
    if (c === ',' && tiefe === 0) {
      teile.push(akt.trim());
      akt = '';
      continue;
    }
    akt += c;
  }
  if (akt.trim()) teile.push(akt.trim());
  return teile;
}

/** Schneidet ab `start` die Klammer-Inhalte des Aufrufs heraus. */
function klammerInhalt(src, start) {
  let tiefe = 0,
    str = null;
  for (let i = start; i < src.length; i++) {
    const c = src[i];
    if (str) {
      if (c === str && src[i - 1] !== '\\') str = null;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') {
      str = c;
      continue;
    }
    if (c === '(') tiefe++;
    else if (c === ')') {
      tiefe--;
      if (tiefe === 0) return src.slice(start + 1, i);
    }
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
  // Eine JSON-Antwort statt eines Stroms (Fachfehler, „exists“) macht readSSE() zu einem Ereignis.
  const lesen = fs.readFileSync(path.join(ROOT, 'public', 'js', 'fortschritt.js'), 'utf8');
  for (const m of lesen.matchAll(/onEvent\(\{\s*step:[^,}]*\?\s*'(\w+)'\s*:\s*'(\w+)'/g)) {
    erreichbar.add(m[1]);
    erreichbar.add(m[2]);
  }

  for (const [datei, src] of quellen) {
    for (const m of src.matchAll(/(?:async\s+)?function\s+(\w+)\s*\(/g)) {
      const name = m[1];
      const params = klammerInhalt(src, m.index + m[0].length - 1);
      if (params === null || !/\bsendProgress\b/.test(params)) continue;
      const idx = argumente(params).findIndex(a => /^sendProgress\b/.test(a));
      assert.notEqual(idx, -1, `${datei}: sendProgress-Parameter von ${name} nicht gefunden`);

      // Meldet diese Funktion überhaupt Schritte?
      const rumpf = klammerInhalt(src, src.indexOf('{', m.index + m[0].length)) ?? '';
      const gemeldet = [...src.slice(m.index).matchAll(/sendProgress\(\{\s*step\s*:\s*'([^']+)'/g)].map(x => x[1]);
      if (!gemeldet.length) continue;

      // Übergibt irgendein Aufrufer etwas anderes als null?
      let lebt = false;
      for (const [, s2] of quellen) {
        for (const c of s2.matchAll(new RegExp(`\\b${name}\\s*\\(`, 'g'))) {
          if (/function\s*$/.test(s2.slice(0, c.index))) continue; // die Deklaration selbst
          const args = klammerInhalt(s2, c.index + c[0].length - 1);
          if (args === null) continue;
          const a = argumente(args)[idx];
          if (a !== undefined && a !== 'null') {
            lebt = true;
            break;
          }
        }
        if (lebt) break;
      }
      if (lebt) for (const g of gemeldet) erreichbar.add(g);
      void rumpf;
    }
  }
  return erreichbar;
}

const galerie = fs.readFileSync(path.join(ROOT, 'public', 'js', 'fortschritt.js'), 'utf8');
const html = fs.readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8');

test('jeder Schritt im Fortschrittsdialog kann den Browser auch erreichen', () => {
  const schalter = galerie.slice(galerie.indexOf('export function handleSseEvent'));
  const rumpf = schalter.slice(0, schalter.indexOf('\n}\n'));
  const faelle = [...rumpf.matchAll(/case\s+'([^']+)'/g)].map(m => m[1]);
  assert.ok(faelle.length >= 3, `handleSseEvent hat nur ${faelle.length} Fälle — Anker stimmt nicht mehr`);

  const erreichbar = erreichbareSchritte();
  assert.ok(erreichbar.size >= 4, `nur ${erreichbar.size} erreichbare Schritte gefunden — Anker stimmt nicht mehr`);

  const tot = faelle.filter(f => !erreichbar.has(f));
  assert.deepEqual(
    tot,
    [],
    `Der Dialog behandelt Schritte, die keine Serverstelle mehr sendet: ${tot.join(', ')}. ` +
      'Entweder sendet der Server sie wieder, oder der Fall gehört aus handleSseEvent entfernt.',
  );
});

test('jede angesprochene ps-Kennung gibt es auch im Dialog', () => {
  const ids = new Set([...galerie.matchAll(/'ps-([a-z-]+)'/g)].map(m => 'ps-' + m[1]));
  // setStep() setzt die Kennung aus 'ps-' + Name zusammen; beide Formen einsammeln.
  for (const m of galerie.matchAll(/setStep\('([a-z-]+)'/g)) ids.add('ps-' + m[1]);
  assert.ok(ids.size >= 2, `nur ${ids.size} ps-Kennungen gefunden — Anker stimmt nicht mehr`);

  const fehlend = [...ids].filter(id => !html.includes(`id="${id}"`));
  assert.deepEqual(fehlend, [], `Frontend spricht Elemente an, die es in index.html nicht gibt: ${fehlend.join(', ')}`);
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
 */
test('nach dem letzten Ereignis hängt kein Punkt mehr auf „aktiv"', () => {
  // ── Sendereihenfolge, wie der Erfassungsstrom sie erzeugt ───────────────
  // Die Route meldet vor und nach dem Ergänzen selbst; dazwischen meldet katalogHolen().
  const lies = rel => ohneKommentare(fs.readFileSync(path.join(ROOT, rel), 'utf8'));
  const route = require('./helpers/sources').kompakt(lies('routes/api_v1/setsImport.ts'));
  // Die Route und ihr Helfer ergaenzeImStrom (vor der Router-Fabrik).
  const strom =
    route.slice(
      route.indexOf("router.post('/sets/add-stream'"),
      route.indexOf("router.post('/sets/:setNumber/parts'"),
    ) +
    route.slice(
      route.indexOf('async function ergaenzeImStrom('),
      route.indexOf('export function baueSetsImportRouter'),
    );
  assert.ok(strom.includes('setErgaenzen('), 'Erfassungsstrom nicht gefunden — Anker stimmt nicht mehr');
  const erfassen = lies('src/sets/erfassen.ts');
  const katalog = erfassen.slice(
    erfassen.indexOf('async function katalogHolen('),
    erfassen.indexOf('export async function setErgaenzen('),
  );
  const schritte = t => [...t.matchAll(/step\s*:\s*'([^']+)'/g)].map(m => m[1]);
  const [vor, nach] = strom.split('setErgaenzen(');
  const folge = [...schritte(vor), ...schritte(katalog), ...schritte(nach)];
  assert.ok(folge.length >= 4, `der Strom meldet nur ${folge.length} Schritte — Anker stimmt nicht mehr`);

  // ── Schaltlogik, wie handleSseEvent() sie ausführt ───────────────────────
  const schalter = galerie.slice(galerie.indexOf('export function handleSseEvent'));
  const rumpf = schalter.slice(0, schalter.indexOf('\n}\n'));
  const wirkung = {};
  for (const zweig of rumpf.split(/(?=\bcase\s+')/)) {
    const c = zweig.match(/^case\s+'([^']+)'\s*:/);
    if (!c) continue;
    wirkung[c[1]] = [...zweig.matchAll(/setStep\('([a-z-]+)'\s*,\s*'(\w+)'\)/g)].map(m => [m[1], m[2]]);
  }

  // ── Durchspielen ─────────────────────────────────────────────────────────
  const zustand = {};
  for (const ereignis of folge) {
    for (const [punkt, wert] of wirkung[ereignis] || []) zustand[punkt] = wert;
  }

  const haengt = Object.entries(zustand)
    .filter(([, w]) => w === 'active')
    .map(([k]) => k);
  assert.deepEqual(
    haengt,
    [],
    `Diese Punkte bleiben am Ende auf „aktiv" hängen: ${haengt.join(', ')}. ` +
      'Entweder sendet der Server ein abschliessendes Ereignis dafür, oder der ' +
      'Punkt gehört nicht in den Dialog — er zeigt sonst dauerhaft Arbeit an, ' +
      'auf die niemand wartet.',
  );

  // Und jeder Punkt, den es im Dialog GIBT, muss der Ablauf auch erreichen.
  const gezeigt = [...html.matchAll(/class="prog-step" id="ps-([a-z-]+)"/g)].map(m => m[1]);
  assert.ok(gezeigt.length >= 2, `nur ${gezeigt.length} Punkte im Dialog — Anker stimmt nicht mehr`);
  const nieBeruehrt = gezeigt.filter(g => !(g in zustand));
  assert.deepEqual(
    nieBeruehrt,
    [],
    `Diese Punkte stehen im Dialog, werden aber nie geschaltet: ${nieBeruehrt.join(', ')}`,
  );
});
