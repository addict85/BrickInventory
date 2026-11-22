// In ES modules functions do not live on window; data-click="name" therefore finds its handler here. A
// typo in the name is thus noticed in the test instead of only when clicking.
import { html } from './escaping.js';

/** name → function. Filled by the individual modules. */
const _actions = new Map();

/**
 * Register handlers.
 *
 * Called at the end of each module with an object literal of its own handlers: `registerActions({
 * loadGallery, openModal })`. The shorthand notation ensures that key and function name cannot
 * drift apart.
 *
 * @param {Record<string, Function>} map
 */
export function registerActions(map) {
  for (const [name, fn] of Object.entries(map)) {
    if (typeof fn !== 'function') {
      console.warn('[actions] not a function:', name);
      continue;
    }
    if (_actions.has(name)) console.warn('[actions] handler registered twice:', name);
    _actions.set(name, fn);
  }
}

/** Only registered handlers, no fallback to window: otherwise every global
 * function (open, close, print …) would be callable from injected markup. The
 * log viewer in the popup resolves its handlers itself (js/logviewer.js).
 * @param {string} name
 * @returns {Function|null} */
export function resolveAction(name) {
  const fn = _actions.get(name);
  return typeof fn === 'function' ? fn : null;
}

// Random marker per page load. Dangerous actions only run from elements that were already in the markup at load
// or whose template carries genuine(); injected HTML does not know the marker.
const _brand =
  typeof crypto !== 'undefined' && crypto.getRandomValues
    ? [...crypto.getRandomValues(new Uint8Array(12))].map(b => b.toString(16).padStart(2, '0')).join('')
    : String(Math.random()).slice(2);
const _ofStart = new WeakSet();
if (typeof document !== 'undefined')
  for (const el of document.querySelectorAll('[data-click],[data-change],[data-input],[data-blur],[data-keydown]'))
    _ofStart.add(el);

/** Attribute for templates that trigger a dangerous action. */
export function genuine() {
  return html` data-genuine="${_brand}"`;
}

/** @param {Element} el  the element with the data-* attribute */
export function isTrusted(el) {
  return _ofStart.has(el) || el.getAttribute('data-genuine') === _brand;
}

/** All registered names — for tests and debugging. */
export function actionNames() {
  return [..._actions.keys()].sort();
}
