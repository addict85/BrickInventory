import { LANG, applyLang, tRaw } from '../i18n.js';
import { _settingsCache, ME } from './00-zustand.js';
import { abonniere } from './00-ereignisse.js';
import { registerActions } from './00-registry.js';
import { G, eins } from './01-dom.js';
import { api } from './01-api.js';

// Was am angemeldeten Konto hängt: Sprache, Design, Name in der Kopfleiste, Hinweis auf den fehlenden
// Rebrickable-Schlüssel.

// ── Hinweis „Rebrickable-Schlüssel fehlt“ ───────────────────────────────────
const RB_HINWEIS_WEG = 'bim_rb_hinweis_weg';

/** Weggeklickt bleibt das Band 30 Tage weg, auch über Neustarts: Bei 200 %
 * Zoom kostet es ein Achtel der Höhe; erinnert wird später trotzdem. */
const RB_HINWEIS_FRIST = 30 * 24 * 3600 * 1000;

/** Über dem Einrichtungsassistenten nicht: Der fragt genau diesen Schlüssel ab.
 * Schliesst man ihn mit „Später“, kommt das Band (22-einrichtung.js). */
export function rbHinweisZeigen() {
  const band = G('rb-hinweis');
  if (!band || !ME?.isAdmin || G('einrichtung-modal')?.classList.contains('open')) return;
  if (String(_settingsCache?.rebrickable_api_key || '').trim()) return;
  try {
    const weg = Number(localStorage.getItem(RB_HINWEIS_WEG));
    if (weg && Date.now() - weg < RB_HINWEIS_FRIST) return;
  } catch (_) { /* ohne Speicher: zeigen */ }
  band.hidden = false;
}

export function rbHinweisVerbergen() { const b = G('rb-hinweis'); if (b) b.hidden = true; }

function rbHinweisOeffnen() {
  rbHinweisVerbergen();
  eins('.ntab[data-tab="settings"]')?.click();
  /** @type {HTMLElement|null} */ (document.querySelector('.einst-nav a[data-arg="einst-rb"]'))?.click();
  G('rb-key')?.focus();
}

/** Wegklicken gilt RB_HINWEIS_FRIST lang; der Fokus geht an den Seiteninhalt statt ins Leere. */
function rbHinweisWeg() {
  rbHinweisVerbergen();
  try { localStorage.setItem(RB_HINWEIS_WEG, String(Date.now())); } catch (_) { /* dann eben bis zum Neuladen */ }
  G('inhalt')?.focus({ preventScroll: true });
}

// ── LANGUAGE HELPERS ────────────────────────────────────────────────────────
/** @param {string} lang */
export function setLang(lang) {
  applyLang(lang, true);
  _updateLangSelect();
}

export function _updateLangSelect() {
  const sel = /** @type {HTMLSelectElement | null} */ (document.getElementById('lang-select'));
  if (sel) sel.value = LANG;
}

// Reicht das Design an 00-theme-boot.js weiter, das es schon im <head> anwendet und den Cache führt: So wirkt
// ein Wechsel sofort und beim nächsten Laden ohne Aufblitzen.
// Ausführlich: docs/begruendungen/public/js/01-konto.js.md#applytheme
/**
 * @param {string} theme
 */
export function applyTheme(theme){
  // Keine eigene Liste gültiger Designs: Die alte kannte zwei von sechs, und die neueren wirkten erst nach
  // dem Neuladen. Gültig ist, was 00-theme-boot.js kennt; ohne dieses Skript wird nichts gesetzt.
  // Ausführlich: docs/begruendungen/public/js/01-konto.js.md#if
  if (typeof window.__bimApplyTheme !== 'function') return null;
  return window.__bimApplyTheme(theme);
}

export async function initDefaultCondition(){
  try {
    // Effektiver Default des Nutzers (User-Override → global → 'N'), damit die Erfassungsformulare den in den
    // Einstellungen gewählten Zustand vorbelegen.
    const d = await api('GET', '/v1/settings/user/default-condition');
    if (d?.success && d.condition) {
      ['add-condition','ap-condition','af-condition'].forEach(id => {
        const el = G(id);
        if (el) el.value = d.condition;
      });
    }
  } catch(e) {}
}

/**
 * Der Name in der Kopfleiste, für Verwalter mit „(Verwalter)“ statt eigener Plakette. Eine Funktion, weil
 * Anmeldung und Profil ihn schreiben und eine zweite Fassung schon einmal ins Leere lief.
 * Ausführlich: docs/begruendungen/public/js/01-konto.js.md#zeigebenutzernamen
 */
export function zeigeBenutzernamen(){
  const el = G('ubadge');
  if (!el || !ME) return;
  const rolle = tRaw('users.admin_badge');
  // „admin (Admin)“ sagte dasselbe zweimal.
  el.textContent = ME.isAdmin && ME.username.toLocaleLowerCase() !== rolle.toLocaleLowerCase()
    ? `${ME.username} (${rolle})`
    : ME.username;
}

registerActions({
  rbHinweisOeffnen,
  rbHinweisWeg,
});

// Die gewählte Sprache am Konto speichern (i18n.js meldet den Wechsel). Was der Code zur Laufzeit schreibt
// (Kontoschild „Name (Verwalter)“), zieht nach.
abonniere('spracheGewechselt', ({ sprache, speichern }) => {
  if (ME) zeigeBenutzernamen();
  if (speichern) api('POST', '/v1/settings', { language: sprache });
});
