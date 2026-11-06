/**
 * Der Kontofilter wird bei jeder Anmeldung auf „Alle Konten" zurückgesetzt.
 *
 * Der Filter liegt im localStorage (eine Ansichtseinstellung je Gerät) und
 * überlebte deshalb Abmelden und Anmelden: Nach dem Login sah die halbe
 * Sammlung verschwunden aus. Nur beim Anmelden, nicht bei jedem Seitenaufbau —
 * innerhalb einer Sitzung soll die Wahl ein F5 überleben.
 *
 * Gegenprobe (durchgeführt): den resetScopeModes()-Aufruf aus doLogin
 * entfernt → der zweite Teilschritt wird rot.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const src = require('./helpers/sources').coreQuelle();
const code = src.split('\n').filter(l => !l.trim().startsWith('//') && !l.trim().startsWith('*')).join('\n');

test('es gibt einen Helfer, der alle vier Ansichten zurücksetzt', () => {
  assert.match(code, /export function resetScopeModes\(\)/,
    'resetScopeModes() fehlt');
  assert.match(code, /for \(const view of SCOPE_VIEWS\) localStorage\.removeItem\('bim_scope_' \+ view\)/,
    'der Helfer muss ALLE Ansichten aus SCOPE_VIEWS räumen, nicht einzelne aufzählen');
});

test('die Anmeldung ruft ihn auf — vor dem Aufbau der Oberfläche', () => {
  const login = code.slice(code.indexOf('async function doLogin'));
  const block = login.slice(0, 1200);
  const reset = block.indexOf('resetScopeModes()');
  // oeffneApp() baut die Oberfläche auf (oder zeigt zuerst den Pflichtwechsel).
  const show  = block.indexOf('oeffneApp()');
  assert.ok(reset > 0, 'doLogin setzt den Kontofilter nicht zurück');
  assert.ok(show > 0 && reset < show,
    'das Zurücksetzen muss VOR oeffneApp() stehen — sonst entstehen die Auswahlfelder noch mit dem alten Wert');
});

test('der Filter wird beim Wechseln der Ansicht weiterhin gemerkt', () => {
  // Die Persistenz selbst bleibt: Nur die Anmeldung räumt auf, nicht jeder
  // Seitenaufbau. Ohne diese Prüfung könnte der nächste Umbau das Speichern
  // ganz entfernen und damit über das Ziel hinausschiessen.
  assert.match(code, /localStorage\.setItem\('bim_scope_' \+ view, mode\)/,
    'setScopeMode darf weiterhin speichern');
});
