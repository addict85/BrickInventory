/**
 * Der Kontofilter wird bei jeder Anmeldung auf „Alle Konten" zurückgesetzt.
 *
 * ── Woher dieser Test kommt (Marcos Wunsch, Nachtrag 46) ────────────────────
 * Der Filter liegt bewusst im localStorage — er ist eine Ansichtseinstellung
 * wie „Kachel oder Tabelle", und am Telefon will man sie womöglich anders als
 * am Rechner. Genau das machte ihn aber zur Falle: Er überlebte Abmelden und
 * Anmelden. Wer zuletzt auf ein einzelnes Konto gefiltert hatte, sah nach dem
 * nächsten Login wieder nur dessen Sets, ohne dass etwas darauf hinwies — es
 * sah aus, als sei die halbe Sammlung verschwunden.
 *
 * Bewusst NUR beim Anmelden, nicht bei jedem Seitenaufbau: Innerhalb einer
 * Sitzung soll eine getroffene Wahl auch ein F5 überleben.
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
  const show  = block.indexOf('showApp()');
  assert.ok(reset > 0, 'doLogin setzt den Kontofilter nicht zurück');
  assert.ok(show > 0 && reset < show,
    'das Zurücksetzen muss VOR showApp() stehen — sonst entstehen die Auswahlfelder noch mit dem alten Wert');
});

test('der Filter wird beim Wechseln der Ansicht weiterhin gemerkt', () => {
  // Die Persistenz selbst bleibt: Nur die Anmeldung räumt auf, nicht jeder
  // Seitenaufbau. Ohne diese Prüfung könnte der nächste Umbau das Speichern
  // ganz entfernen und damit über das Ziel hinausschiessen.
  assert.match(code, /localStorage\.setItem\('bim_scope_' \+ view, mode\)/,
    'setScopeMode darf weiterhin speichern');
});
