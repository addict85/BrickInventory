// Der Kontofilter je Ansicht ist eine eigene Datei: Er hängt an keinem anderen Modul, nur am
// localStorage, und hat mit dem Kern nichts zu tun.
// Ausführlich: docs/begruendungen/public/js/14-scope.js.md#dieser-abschnitt-lag-in-js-01-core-js-de
/**
 * Der Kontofilter gilt je Ansicht: Wer in der Galerie den Haushalt sieht, will in den Finanzen
 * vielleicht nur die eigenen Zahlen. Gefiltert wird am Server (accounts=), sonst stimmten Gesamtzahl
 * und Bewertung nicht.
 * Ausführlich: docs/begruendungen/public/js/14-scope.js.md#ein-hauptkonto-kann-je-ansicht-zwischen
 */
// 'merkliste' steht seit dem 24.09. mit darin (Marcos Vorgabe: „In der
// Merkliste noch einen Filter analog den Sets einbauen inkl. Inhaber"). Der
// Server verstand `accounts=` auf /v1/wanted schon immer — scopeIds() gilt
// dort wie ueberall —, nur schickte es keine der beiden Oberflaechen. Es
// fehlte also allein die Wahl.
export const SCOPE_VIEWS = ['gallery', 'parts', 'minifigs', 'finance', 'merkliste'];

/**
 * @param {string} view
 */
export function scopeMode(view) {
  return localStorage.getItem('bim_scope_' + view) || 'all';
}

/**
 * @param {string} view
 * @param {string} mode
 */
export function setScopeMode(view, mode) {
  localStorage.setItem('bim_scope_' + view, mode);
}

/**
 * Kontofilter bei jeder Anmeldung zurücksetzen: Er liegt im localStorage und überlebte sonst Ab- und
 * Anmelden — wer zuletzt auf ein Konto gefiltert hatte, sah danach nur dessen Sets und hielt den Rest
 * für verloren.
 * Ausführlich: docs/begruendungen/public/js/14-scope.js.md#resetscopemodes
 */
export function resetScopeModes() {
  for (const view of SCOPE_VIEWS) localStorage.removeItem('bim_scope_' + view);
  // Der Lagerortfilter hängt an derselben Begründung und wird deshalb hier
  // mit zurückgesetzt — nicht in einem zweiten Aufruf, den jemand vergisst.
  resetLagerModi();
}

/** `accounts=` an eine URLSearchParams hängen — nur wenn nötig. */
/** @param {URLSearchParams} p @param {string} view */
export function addScopeParam(p, view) {
  const m = scopeMode(view);
  // 'all' ist die Vorgabe des Servers; weglassen hält die Adressen kurz und
  // die Antworten cachebar.
  if (m && m !== 'all') p.set('accounts', m);
  return p;
}

/**
 * Fertiges Suffix für Aufrufe ohne URLSearchParams (Finanzen).
 * @param {string} view
 */
export function scopeQuery(view) {
  const m = scopeMode(view);
  return (m && m !== 'all') ? `?accounts=${m}` : '';
}
// Der Lagerortfilter steht hier, weil er derselbe Gegenstand ist wie der Kontofilter: eine Wahl je
// Ansicht, am Server gefiltert, beim Anmelden zurückgesetzt — aus denselben Gründen.
// Ausführlich: docs/begruendungen/public/js/14-scope.js.md#der-lagerortfilter-ist-derselbe-gegensta

/** Ansichten mit einem Lagerortfilter. Sets und Teile — nur die haben einen. */
export const LAGER_VIEWS = ['gallery', 'parts'];

/**
 * @param {string} view
 */
export function lagerModus(view) {
  return localStorage.getItem('bim_lager_' + view) || '';
}

/**
 * @param {string} view
 * @param {string} wert
 */
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
/** @param {URLSearchParams} p @param {string} view */
export function addLagerParam(p, view) {
  const m = lagerModus(view);
  if (m) p.set('storage', m);
  return p;
}

/**
 * Fertiges Suffix für Aufrufe ohne URLSearchParams.
 * @param {string} view
 */
export function lagerQuery(view, trenner = '&') {
  const m = lagerModus(view);
  return m ? `${trenner}storage=${encodeURIComponent(m)}` : '';
}
