// ═══ Kontofilter (Haushalt) — je Ansicht ═══════════════════════════════════
//
// ── Warum eigene Datei (Nachtrag 136) ───────────────────────────────────────
//
// Dieser Abschnitt lag in js/01-core.js. Deren Kopfzeile nennt als Inhalt
// „Utils, i18n-Glue, Auth & Panels, Login/Logout, CSV-Import-Fortschrittsbalken"
// — der Kontofilter ist nichts davon.
//
// Er ist ausserdem der am klarsten abgegrenzte Teil der Datei: Er hängt an
// KEINEM anderen Modul, sondern nur am localStorage. Das macht ihn zum
// natürlichen ersten Schnitt.
/**
 * Ein Hauptkonto kann je Ansicht zwischen Alle / Eigene / Unterkonten
 * umschalten. Die Wahl gilt PRO ANSICHT: Wer in der Galerie den ganzen
 * Haushalt sieht, will in den Finanzen womöglich nur die eigenen Zahlen.
 *
 * Gefiltert wird am Server (`accounts=`) — clientseitig liesse sich zwar eine
 * Kachelwand aussieben, aber weder die Gesamtzahl darunter noch die Bewertung
 * im Finanzreiter.
 *
 * Die Wahl überlebt einen Neuladen (localStorage). Bewusst nicht auf dem
 * Server gespeichert: Es ist eine Ansichtseinstellung wie „Kachel oder
 * Tabelle", keine Eigenschaft des Kontos — und am Telefon will man sie
 * womöglich anders als am Rechner.
 */
export const SCOPE_VIEWS = ['gallery', 'parts', 'minifigs', 'finance'];

export function scopeMode(view) {
  return localStorage.getItem('bim_scope_' + view) || 'all';
}

export function setScopeMode(view, mode) {
  localStorage.setItem('bim_scope_' + view, mode);
}

/**
 * Kontofilter aller Ansichten zurücksetzen — bei jeder ANMELDUNG.
 *
 * ── Warum (Nachtrag 46, Marcos Wunsch) ──────────────────────────────────────
 * Der Filter liegt bewusst im localStorage: Er ist eine Ansichtseinstellung
 * wie „Kachel oder Tabelle", und am Telefon will man sie womöglich anders als
 * am Rechner. Genau das machte ihn aber auch zu einer Falle — er überlebte
 * Abmelden und Anmelden, und wer zuletzt auf ein einzelnes Konto gefiltert
 * hatte, sah nach dem nächsten Login wieder nur dessen Sets, ohne dass etwas
 * darauf hinwies. Das war schwer als Filter zu erkennen; es sah aus, als sei
 * die halbe Sammlung weg.
 *
 * Deshalb: Beim Anmelden gilt IMMER „Alle Konten". Innerhalb einer Sitzung
 * bleibt eine getroffene Wahl erhalten — auch über einen Seitenneuaufbau (F5)
 * hinweg, denn dabei wird nicht neu angemeldet.
 */
export function resetScopeModes() {
  for (const view of SCOPE_VIEWS) localStorage.removeItem('bim_scope_' + view);
  // Der Lagerortfilter hängt an derselben Begründung und wird deshalb hier
  // mit zurückgesetzt — nicht in einem zweiten Aufruf, den jemand vergisst.
  resetLagerModi();
}

/** `accounts=` an eine URLSearchParams hängen — nur wenn nötig. */
export function addScopeParam(p, view) {
  const m = scopeMode(view);
  // 'all' ist die Vorgabe des Servers; weglassen hält die Adressen kurz und
  // die Antworten cachebar.
  if (m && m !== 'all') p.set('accounts', m);
  return p;
}

/** Fertiges Suffix für Aufrufe ohne URLSearchParams (Finanzen). */
export function scopeQuery(view) {
  const m = scopeMode(view);
  return (m && m !== 'all') ? `?accounts=${m}` : '';
}
// ═══ Lagerortfilter — je Ansicht, genau wie der Kontofilter ═══════════════════
//
// ── Warum in DIESER Datei ───────────────────────────────────────────────────
//
// Der Lagerortfilter ist derselbe Gegenstand wie der Kontofilter: eine Wahl je
// Ansicht, die als Anfrageparameter mitreist und am Server in die Abfrage
// eingeht. Er teilt sogar die Begründungen — gefiltert wird am Server, weil
// sich die Gesamtzahl darunter clientseitig nicht aussieben lässt, und die
// Wahl wird beim Anmelden zurückgesetzt, weil sie sonst wie eine verschwundene
// Sammlung aussieht.
//
// Zwei Dateien für dieselbe Sache hätten zwei Fassungen dieser Regeln
// bedeutet, und eine davon wäre irgendwann die ältere.

/** Ansichten mit einem Lagerortfilter. Sets und Teile — nur die haben einen. */
export const LAGER_VIEWS = ['gallery', 'parts'];

export function lagerModus(view) {
  return localStorage.getItem('bim_lager_' + view) || '';
}

export function setLagerModus(view, wert) {
  if (wert) localStorage.setItem('bim_lager_' + view, wert);
  else      localStorage.removeItem('bim_lager_' + view);
}

/** Beim Anmelden zurücksetzen — dieselbe Begründung wie bei resetScopeModes(). */
export function resetLagerModi() {
  for (const view of LAGER_VIEWS) localStorage.removeItem('bim_lager_' + view);
}

/**
 * `storage=` anhängen — nur wenn gefiltert wird.
 *
 * Kein Sonderwert für „ohne Lagerort": Wer danach sucht, sucht in Wahrheit
 * „was muss ich noch einräumen", und das ist eine andere Frage als „wo liegt
 * X". Sie bekäme eine eigene Antwort, keinen Eintrag in diesem Filter.
 */
export function addLagerParam(p, view) {
  const m = lagerModus(view);
  if (m) p.set('storage', m);
  return p;
}

/** Fertiges Suffix für Aufrufe ohne URLSearchParams. */
export function lagerQuery(view, trenner = '&') {
  const m = lagerModus(view);
  return m ? `${trenner}storage=${encodeURIComponent(m)}` : '';
}
