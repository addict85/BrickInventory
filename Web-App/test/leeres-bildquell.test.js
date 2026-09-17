const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const WEB = path.join(__dirname, '..');

/**
 * Ein leeres `src` ist keine leere Adresse — es ist die Adresse der SEITE.
 *
 * ── Was Marco in der Konsole gesehen hat ────────────────────────────────────
 *
 *     [img] konnte nicht geladen werden: https://lego.bigolin.online/
 *
 * Die Meldung kommt aus dem Fehlerlauscher in js/11-actions.js und ist echt:
 * Der Browser hat wirklich versucht, die Startseite als Bild zu laden, und ist
 * daran gescheitert. Die Adresse im Text ist der einzige Hinweis darauf, was
 * passiert ist — sie ist die Seite selbst.
 *
 * Der Grund: Zu einem `<img src="">` loest der Browser das leere src gegen die
 * Dokumentadresse auf. Es gab drei Quellen dafuer:
 *
 *   1. fuenf `<img src="">` in index.html (fuenf Fehlversuche bei JEDEM
 *      Seitenaufruf, vier davon still, weil der Rueckfall gleich das
 *      Platzhalterbild nachlud),
 *   2. `closeImageLightbox()` setzte beim Schliessen des Zooms `src=''`,
 *   3. der Wiederholversuch im Fehlerlauscher selbst setzte `src=''`, um das
 *      Nachladen zu erzwingen.
 *
 * Richtig ist in allen drei Faellen `removeAttribute('src')` bzw. gar kein
 * Attribut: Ohne src laedt der Browser nichts und meldet auch nichts.
 *
 * ── Warum das nicht nur Kosmetik ist ────────────────────────────────────────
 *
 * Die Konsole ist das Werkzeug, mit dem man einen echten Fehler findet. Eine
 * Meldung, die bei jedem Schliessen des Zooms erscheint und nie etwas
 * bedeutet, macht genau dieses Werkzeug unbrauchbar — man hoert auf
 * hinzusehen. Dazu kamen fuenf ueberfluessige Anfragen an den Server pro
 * Seitenaufruf.
 */

test('kein <img> in index.html startet mit leerem src', () => {
  const html = fs.readFileSync(path.join(WEB, 'public', 'index.html'), 'utf8');
  // Selbstbeweis: Findet die Suche ueberhaupt Bilder? GEMESSEN sind es
  // mehrere; ohne diesen Schritt waere die Zusicherung darunter still gruen,
  // sobald sich die Schreibweise der Attribute aendert.
  const bilder = [...html.matchAll(/<img\b[^>]*>/g)].map(m => m[0]);
  assert.ok(bilder.length >= 5, `Nur ${bilder.length} <img> gefunden — greift die Suche noch?`);

  const leer = bilder.filter(b => /\ssrc=(""|'')/.test(b));
  assert.deepEqual(leer, [],
    'Diese Bilder starten mit einem leeren src. Der Browser loest das gegen die ' +
    'Seitenadresse auf, laedt die Startseite als Bild und scheitert daran — ' +
    'einmal je Bild und Seitenaufruf. Das Attribut einfach weglassen.');
});

test('kein Skript setzt ein src auf den leeren Text', () => {
  const ordner = path.join(WEB, 'public', 'js');
  // app.bundle.js ist das ERZEUGNIS dieser Dateien und wird nicht von Hand
  // geschrieben — es hier mitzupruefen hiesse, denselben Fund zweimal zu
  // melden, und beim naechsten Bauen verschwaende er von selbst.
  const dateien = fs.readdirSync(ordner)
    .filter(n => n.endsWith('.js') && n !== 'app.bundle.js');
  assert.ok(dateien.length >= 10, `Nur ${dateien.length} Skripte — greift die Suche noch?`);

  const treffer = [];
  for (const name of dateien) {
    const zeilen = fs.readFileSync(path.join(ordner, name), 'utf8').split('\n');
    zeilen.forEach((z, i) => {
      if (/^\s*\/\//.test(z)) return;                 // Kommentare erklaeren die Regel
      if (/\.src\s*=\s*(''|""|``)\s*[;,)]/.test(z)) treffer.push(`${name}:${i + 1}  ${z.trim()}`);
    });
  }
  assert.deepEqual(treffer, [],
    'Hier wird ein src auf den leeren Text gesetzt. Das ist keine leere ' +
    'Adresse, sondern die Adresse der Seite: Der Browser laedt sie als Bild ' +
    'und der Fehlerlauscher meldet sie in der Konsole. Richtig ist ' +
    "removeAttribute('src').");
});
