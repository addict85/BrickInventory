/**
 * Jedes sichtbare Bedienelement hat einen Namen, den man VORLESEN kann.
 *
 * ── Der Befund ──────────────────────────────────────────────────────────────
 *
 * NACHGEMESSEN trugen ELF sichtbare Knöpfe in index.html nur ein Symbol als
 * Inhalt und sonst nichts: acht Schliessen-Kreuze (✕) der Dialoge, zwei
 * Papierkörbe (🗑️) zum Löschen und die beiden Umschalter zwischen Karten- und
 * Tabellenansicht (⊞ / ☰).
 *
 * Ein Bildschirmleser sagt dazu entweder gar nichts oder den Unicode-Namen des
 * Zeichens („multiplication x"). Wer die Oberfläche sieht, merkt davon nichts —
 * dieselbe Sorte Fehler wie die fehlenden aria-label-Schlüssel aus Nachtrag
 * 142, und aus demselben Grund so lange unbemerkt.
 *
 * Dazu ein zwölfter Fall, den die erste Messung ÜBERSAH, weil er ein
 * aria-label HAT: `<select id="mon-default-condition" aria-label=
 * "mon-default-condition">`. Vorgelesen wurde der Bezeichner selbst.
 *
 * ── Die App hat diese Regel seit jeher ──────────────────────────────────────
 *
 * Android-App/…/IconButtonLabelTest.kt besteht darauf, dass jeder IconButton
 * eine contentDescription trägt. Die Weboberfläche hatte nichts Vergleichbares
 * — beide Oberflächen sollen aber gleich gut bedienbar sein, nicht nur gleich
 * aussehen.
 *
 * ── Was als Name zählt ──────────────────────────────────────────────────────
 *
 *   aria-label / aria-labelledby / title       direkt am Element
 *   data-i18n OHNE data-i18n-attr              setzt textContent zur Laufzeit
 *   ein <label for="…">                        gehört zum Element
 *   sichtbarer Text mit mindestens zwei Buchstaben
 *
 * Ein Emoji oder ein Symbol zählt NICHT — genau darum geht es.
 *
 * ── Was NICHT geprüft wird, und warum ───────────────────────────────────────
 *
 * Elemente in einem `display:none`-Teilbaum. In index.html stehen sechs leere
 * Knöpfe („Hidden stubs so existing JS references don't break"); sie sind für
 * einen Bildschirmleser gar nicht vorhanden. Sie hier zu melden hiesse, eine
 * Regel an einer Stelle zu erzwingen, an der sie nichts bewirkt — und drei
 * Fehlalarme sind genug, damit die ganze Prüfung abgeschaltet wird.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');

/** Der Seitenquelltext ohne Kommentare und ohne `display:none`-Teilbäume. */
function sichtbaresHtml() {
  const roh = fs.readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8')
    .replace(/<!--[\s\S]*?-->/g, '');
  const teile = [];
  let i = 0;
  for (const m of roh.matchAll(/<div[^>]*style="[^"]*display:\s*none[^"]*"[^>]*>/g)) {
    if (m.index < i) continue;
    teile.push(roh.slice(i, m.index));
    // Bis zum passenden </div> springen — verschachtelte <div> mitzählen.
    let tiefe = 1, ende = m.index + m[0].length;
    for (const t of roh.slice(ende).matchAll(/<div\b|<\/div>/g)) {
      tiefe += t[0].startsWith('<div') ? 1 : -1;
      if (tiefe === 0) { ende = ende + t.index + t[0].length; break; }
    }
    i = ende;
  }
  teile.push(roh.slice(i));
  return teile.join('');
}

test('jedes sichtbare Bedienelement hat einen vorlesbaren Namen', () => {
  const html = sichtbaresHtml();
  const labels = new Set([...html.matchAll(/<label[^>]*\bfor="([^"]+)"/g)].map(m => m[1]));

  const hatNamen = (attrs, inhalt) => {
    if (/\b(aria-label|aria-labelledby|title)\s*=/.test(attrs)) return true;
    // data-i18n ohne -attr setzt den TEXT des Elements (i18n.js, applyLang).
    if (/\bdata-i18n="/.test(attrs) && !/\bdata-i18n-attr=/.test(attrs)) return true;
    const id = (attrs.match(/id="([^"]+)"/) || [, ''])[1];
    if (id && labels.has(id)) return true;
    // Mindestens zwei Buchstaben — ein Emoji oder ein ✕ ist kein Name.
    return /[^\W\d_]{2,}/u.test(inhalt.replace(/<[^>]+>/g, ''));
  };

  const ohneNamen = [];
  let gefunden = 0;
  for (const m of html.matchAll(/<(button|a|select|textarea)\b([^>]*)>([\s\S]*?)<\/\1>/g)) {
    const [, tag, attrs, inhalt] = m;
    if (tag === 'a' && !/\bhref=/.test(attrs)) continue;   // Anker ohne Ziel
    gefunden++;
    if (!hatNamen(attrs, inhalt)) {
      const id = (attrs.match(/id="([^"]+)"/) || [, '(ohne id)'])[1];
      ohneNamen.push(`<${tag}> ${id} — Inhalt „${inhalt.replace(/<[^>]+>/g, '').trim().slice(0, 12)}"`);
    }
  }
  // Selbstbeweis: Findet das Muster nichts, wäre die Prüfung still grün.
  // GEMESSEN sind es über 90 Bedienelemente.
  assert.ok(gefunden >= 50, `Nur ${gefunden} Bedienelemente gefunden — Muster veraltet?`);

  assert.deepEqual(ohneNamen, [],
    'Diese Bedienelemente tragen nur ein Symbol oder gar nichts:\n  ' +
    ohneNamen.join('\n  ') +
    '\nEin Bildschirmleser sagt dazu nichts oder den Unicode-Namen des Zeichens. ' +
    'aria-label plus data-i18n-attr="aria-label" macht ihn übersetzbar.');
});

test('kein aria-label, das nur der Bezeichner ist', () => {
  const html = sichtbaresHtml();
  const schlecht = [];
  let geprueft = 0;
  for (const m of html.matchAll(/<(\w+)\b([^>]*\baria-label="([^"]+)"[^>]*)>/g)) {
    const [, tag, attrs, wert] = m;
    geprueft++;
    const id = (attrs.match(/id="([^"]+)"/) || [, ''])[1];
    // Wörtlich die id, oder etwas, das wie ein Bezeichner aussieht:
    // klein geschrieben, ohne Leerzeichen, mit Binde- oder Unterstrich.
    if (wert === id || (!/\s/.test(wert) && /[-_]/.test(wert) && wert === wert.toLowerCase()))
      schlecht.push(`<${tag}> id="${id}" aria-label="${wert}"`);
  }
  assert.ok(geprueft >= 20, `Nur ${geprueft} aria-label gefunden — Muster veraltet?`);

  // Zwei aria-label an EINEM Element sind ungültiges HTML, und die beiden
  // Leser sind sich uneins: Der Browser nimmt das erste, das Muster oben —
  // `[^>]*` ist gierig — das letzte. Genau das ist beim Nachziehen der
  // Schliessen-Kreuze passiert: Einer trug schon eines, mein Ersetzen fügte
  // ein zweites an. Aufgefallen ist es nur, weil ich danach gesucht habe.
  const doppelt = [...html.matchAll(/<(\w+)\b[^>]*aria-label="[^"]*"[^>]*aria-label="/g)]
    .map(m => m[0].slice(0, 70));
  assert.deepEqual(doppelt, [],
    'Diese Elemente tragen ZWEI aria-label:\n  ' + doppelt.join('\n  ') +
    '\nDer Browser nimmt das erste, diese Prüfung das letzte — sie können ' +
    'Verschiedenes sagen.');
  assert.deepEqual(schlecht, [],
    'Diese aria-label sind Bezeichner, keine Sätze:\n  ' + schlecht.join('\n  ') +
    '\nVorgelesen wird der Wert — „mon-default-condition" hilft niemandem.');
});
