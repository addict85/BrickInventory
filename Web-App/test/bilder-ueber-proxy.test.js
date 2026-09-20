/**
 * Jedes Bild geht über den eigenen Server — sonst blockt die Richtlinie es.
 *
 * ── Marcos Befund ───────────────────────────────────────────────────────────
 *
 * „Die Bilder in der Wunschliste werden nicht geladen. Anscheinend wird direkt
 * das CDN aufgerufen anstelle über den Proxy zu gehen wie bei allen anderen
 * Bildern." — In der Browser-Konsole stand dazu:
 *
 *     Loading the image 'https://cdn.rebrickable.com/media/sets/21369-1.jpg'
 *     violates the following Content Security Policy directive:
 *     "img-src 'self' data: blob:". The action has been blocked.
 *
 * Die Richtlinie ist richtig so (server.ts) — der Fehler lag in der Zeile:
 *
 *     <img src="${esc(thumbUrl(w.image_url))}"        ← direkt ans CDN
 *
 * thumbUrl() reicht seine Eingabe unverändert durch (01-core.js); erst
 * imgUrl() bzw. fullUrl() machen daraus eine Adresse auf dem eigenen Server.
 *
 * ── Was diese Prüfung festhält ──────────────────────────────────────────────
 *
 * Nicht „Datei X muss Y enthalten", sondern die Regel: Wer in einem
 * src-Attribut ein Bildfeld einsetzt, muss es durch imgUrl() oder fullUrl()
 * schicken. Das ist die Naht, an der es zerbrochen ist.
 *
 * ── Gegenprobe (durchgeführt, Ergebnis im Commit) ──────────────────────────
 *   Die alte Zeile in 16-wunschliste.js wiederhergestellt → rot.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { ohneKommentare } = require('./helpers/sources');

const ROOT = path.join(__dirname, '..');
const JS = path.join(ROOT, 'public', 'js');

/** Felder, die eine FREMDE Adresse tragen können. */
const BILDFELD = /image_url|image_local|imageUrl|set_img_url|thumbUrl\(/;

test("die Richtlinie erlaubt nur 'self' — darauf beruht die Regel unten", () => {
  // Ohne diesen Nachweis wäre die Prüfung darunter eine Geschmacksfrage.
  const server = fs.readFileSync(path.join(ROOT, 'server.ts'), 'utf8');
  assert.match(server, /"img-src 'self' data: blob:"/,
    'Die Bildrichtlinie sieht anders aus — dann gilt die Begründung unten nicht mehr');
});

test('kein src-Attribut setzt ein Bildfeld ohne imgUrl()/fullUrl() ein', () => {
  const dateien = fs.readdirSync(JS)
    .filter(f => f.endsWith('.js') && f !== 'app.bundle.js');
  assert.ok(dateien.length >= 10, `Nur ${dateien.length} Skripte — greift die Suche noch?`);

  const treffer = [];
  let geprueft = 0;
  for (const name of dateien) {
    const src = ohneKommentare(fs.readFileSync(path.join(JS, name), 'utf8'));
    // src="${ … }" in einem Template — die Form, in der die Oberflächen
    // Bilder schreiben.
    for (const m of src.matchAll(/\bsrc="\$\{([^}]*(?:\}[^"]*\{[^}]*)*)\}"/g)) {
      geprueft++;
      const ausdruck = m[1];
      if (!BILDFELD.test(ausdruck)) continue;          // kein Bildfeld — egal
      if (/\b(imgUrl|fullUrl)\(/.test(ausdruck)) continue;
      treffer.push(`${name}:${src.slice(0, m.index).split('\n').length}`);
    }
  }
  assert.ok(geprueft >= 5, `Nur ${geprueft} src-Einsetzungen gefunden — greift die Suche noch?`);
  assert.deepEqual(treffer, [],
    'Hier steht eine Bildadresse ungefiltert im src. Ist sie absolut (CDN), ' +
    "blockt die Richtlinie img-src 'self' das Laden — genau Marcos Befund.");
});
