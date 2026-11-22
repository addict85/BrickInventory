// The account filter per view is a file of its own: it depends on no other module, only on localStorage,
// and has nothing to do with the core.
/**
 * The account filter applies per view: whoever sees the household in the gallery may want only
 * their own numbers in the finances. Filtering happens on the server (accounts=), otherwise total and valuation would not match.
 */
// 'merkliste' has been included since 24.09. (Marco's requirement: "Add a filter to the wishlist like for the
// sets, including owner"). The server always understood `accounts=` on /v2/wanted — scopeIds() applies
// there as everywhere —, only neither of the two UIs sent it. So only the choice was missing.
export const SCOPE_VIEWS = ['gallery', 'parts', 'minifigs', 'finance', 'wanted'];

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
 * Reset the account filter on every login: it lives in localStorage and would otherwise survive logging out and in
 * — whoever had last filtered on one account then saw only its sets and thought the rest was lost.
 */
export function resetScopeModes() {
  for (const view of SCOPE_VIEWS) localStorage.removeItem('bim_scope_' + view);
  // The storage location filter rests on the same reasoning and is therefore reset here as well — not in a
  // second call that someone forgets.
  resetLocationModi();
}

/** Append `accounts=` to a URLSearchParams — only if needed. */
/** @param {URLSearchParams} p @param {string} view */
export function addScopeParam(p, view) {
  const m = scopeMode(view);
  // 'all' is the server's default; omitting it keeps the addresses short and the responses cacheable.
  if (m && m !== 'all') p.set('accounts', m);
  return p;
}

/**
 * Finished suffix for calls without URLSearchParams (finances).
 * @param {string} view
 */
export function scopeQuery(view) {
  const m = scopeMode(view);
  return m && m !== 'all' ? `?accounts=${m}` : '';
}
// The storage location filter lives here because it is the same subject as the account filter: one choice per view,
// filtered on the server, reset at login — for the same reasons.

/** Views with a storage location filter. Sets and parts — only those have one. */
export const LOCATION_VIEWS = ['gallery', 'parts'];

/**
 * @param {string} view
 */
export function locationMode(view) {
  return localStorage.getItem('bim_location_' + view) || '';
}

/**
 * @param {string} view
 * @param {string} value
 */
export function setLocationMode(view, value) {
  if (value) localStorage.setItem('bim_location_' + view, value);
  else localStorage.removeItem('bim_location_' + view);
}

/** Reset at login — the same reasoning as for resetScopeModes(). */
export function resetLocationModi() {
  for (const view of LOCATION_VIEWS) localStorage.removeItem('bim_location_' + view);
}

/**
 * Append `storage=` — only if filtering.
 *
 * No special value for "without storage location": whoever searches for that is really asking "what do I still have to put away", and
 * that is a different question than "where is X". It would get an answer of its own, not an entry in this
 * filter.
 */
/** @param {URLSearchParams} p @param {string} view */
export function addLocationParam(p, view) {
  const m = locationMode(view);
  if (m) p.set('storage', m);
  return p;
}

/**
 * Finished suffix for calls without URLSearchParams.
 * @param {string} view
 */
export function locationQuery(view, divider = '&') {
  const m = locationMode(view);
  return m ? `${divider}storage=${encodeURIComponent(m)}` : '';
}
