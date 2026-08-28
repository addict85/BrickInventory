/**
 * Kein doppelter Neuaufbau des Inhalts beim Neuladen / nach dem Login.
 *
 * Fehlerbild (aus einem Bildschirmvideo, Frames bei 10 fps ausgewertet): Rund
 * 3 Sekunden nach dem Laden wurde der Inhaltsbereich zweimal ausgeräumt und neu
 * gebaut — Inhalt → leer → Inhalt → leer → Inhalt. Layout und Design standen
 * durchgehend, es war also KEIN Theme-Wechsel.
 *
 * Zwei Ursachen, die sich addierten:
 *
 *   1. applyLang() lud am Ende den aktiven Tab neu, für die Galerie sogar
 *      `renderGallery(); loadGallery();`. Der Block lief bei JEDEM Aufruf —
 *      beim Start also zweimal (checkAuth und showApp), obwohl sich die
 *      Sprache gar nicht geändert hatte.
 *   2. loadGallery() setzte das Grid sofort auf einen Spinner, bevor die
 *      Anfrage überhaupt draussen war. Beim Auffrischen verschwanden dadurch
 *      gültige Kacheln für die Dauer eines Roundtrips.
 *
 * Ausführen: npm test
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

/**
 * import-/export-Syntax aus einer Moduldatei entfernen.
 *
 * Diese Tests werten den Quelltext in einer vm-Sandbox bzw. in jsdom als
 * KLASSISCHES Skript aus. Seit der Umstellung auf ES-Module enthalten die
 * Dateien import- und export-Anweisungen, die dort einen SyntaxError erzeugen
 * ("Cannot use import statement outside a module"). Die geprüfte Logik ändert
 * sich dadurch nicht — nur die Modulverpackung muss weg.
 *
 * @param {string} src
 * @returns {string}
 */
function stripModuleSyntax(src) {
  const body = src
    .replace(/^import[^;]*;\s*$/gm, '')   // import { a, b } from '…';
    .replace(/^export\s+/gm, '');          // export function/const/let/class
  // registerActions() kommt sonst aus js/00-registry.js und ist nach dem
  // Entfernen der Importe nicht definiert. In der Sandbox interessiert die
  // Anmeldung nicht — dass sie aufgerufen WIRD, prüfen test/csp-actions.test.js
  // und test/bundle-smoke.test.js gegen den echten Quelltext.
  // tRaw() lebt in i18n.js und wird hier nicht mitgeladen. In der Sandbox
  // genügt die Weiterleitung an t(): Der Unterschied liegt allein in der
  // Maskierung der eingesetzten Werte, die diese Tests nicht prüfen.
  return 'function registerActions() {}\n'
       + 'function tRaw(k, v) { return typeof t === "function" ? t(k, v) : k; }\n'
       + body;
}

const PUB = path.join(__dirname, '..', 'public');
const i18n = require('./helpers/sources').i18nAll();
const gallery = stripModuleSyntax(fs.readFileSync(path.join(PUB, 'js', '02-gallery.js'), 'utf8'));

test('applyLang ist bei gleicher Sprache ein No-Op', () => {
  assert.match(i18n, /_langApplied/,
    'Ohne Merker läuft die volle Neuübersetzung beim Start zweimal');
  assert.match(i18n, /if \(_langApplied === lang && !persist\) return;/,
    'Wiederholte Aufrufe mit derselben Sprache müssen früh aussteigen');
});

test('nur ein echter Sprachwechsel baut den aktiven Tab neu auf', () => {
  assert.match(i18n, /const isRealSwitch = _langApplied !== null && _langApplied !== lang;/,
    'Der erste Aufruf ist kein Wechsel — da lädt der normale Startpfad ohnehin alles');
  assert.match(i18n, /if \(!isRealSwitch\) return;/,
    'Der Neuaufbau-Block darf beim Start nicht laufen');
});

test('ein Sprachwechsel lädt die Galerie nicht neu', () => {
  const block = i18n.slice(i18n.indexOf('if (!isRealSwitch) return;'));
  const galleryBranch = block.slice(block.indexOf("activeTab === 'gallery'"));
  assert.doesNotMatch(galleryBranch.slice(0, 200), /loadGallery\(\)/,
    'Ein Sprachwechsel ändert keine Daten — renderGallery() aus dem Cache genügt');
  assert.match(galleryBranch.slice(0, 200), /renderGallery\(\)/,
    'Die Kacheln müssen aber neu gezeichnet werden, damit Beschriftungen umschalten');
});

test('loadGallery zeigt den Spinner nur beim ersten Laden', () => {
  // Anker ohne Klammerinhalt: Die Signatur hat seit Nachtrag 34 einen
  // Parameter (loadGallery(opts = {})). Die geprüfte REGEL ist unverändert.
  const fn = gallery.slice(gallery.indexOf('async function loadGallery('),
                           gallery.indexOf('function renderGallery()'));
  assert.match(fn, /if \(!allSets\.length \|\| !gal\.querySelector\(/,
    'Der Spinner darf bestehende Kacheln nicht ersetzen, solange nur aufgefrischt wird');
  // Der Spinner muss innerhalb der Bedingung stehen, nicht davor
  const spinnerAt = fn.indexOf("class=\"loading\"");
  const guardAt = fn.indexOf('if (!allSets.length');
  assert.ok(guardAt > 0 && guardAt < spinnerAt,
    'Die Bedingung muss VOR dem Leeren stehen, sonst ist sie wirkungslos');
});

test('die Import-Abfrage läuft nicht ungebremst und nicht vor dem Login', () => {
  // Sie pollte alle 3 Sekunden — auch auf dem Login-Screen und auch dann, wenn
  // die Antwort gar kein JSON war. Steht ein Reverse-Proxy davor, liefert der
  // bei einem Neustart eine HTML-Fehlerseite; r.json() warf dann bei jedem
  // Versuch "Unexpected token '<'".
  const core = stripModuleSyntax(require('./helpers/sources').coreQuelle());
  const fn = core.slice(core.indexOf('async function gibCheckOnLoad'),
                        core.indexOf('let _gibCheckTimer = null;'));
  assert.match(fn, /if \(!ME\) return;/, 'Ohne Anmeldung gibt es nichts zu prüfen');
  assert.match(fn, /ct\.includes\('application\/json'\)/,
    'Die Antwort muss vor dem Parsen geprüft werden');
  assert.match(fn, /setInterval\(doCheck, 30000\)/,
    'Nach mehreren Fehlschlägen muss die Abfrage langsamer werden');
  assert.doesNotMatch(fn, /\.then\(r=>r\.json\(\)\)/,
    'Direktes json() ohne Statusprüfung erzeugt bei HTML-Antworten einen Parsefehler');
});
