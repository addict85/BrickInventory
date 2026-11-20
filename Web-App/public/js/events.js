// Events between modules. A lower module reports what happened; whoever must react listens. That
// way the core (API wrapper, progress, trash) needs no import of the views that reload. Delivery
// is synchronous, in subscription order.

/**
 * Name → payload. A new event is entered here; a typo in the name or a wrong payload is then
 * caught by type checking. The event names themselves stay German (chosen before the English
 * migration); renaming them touches every call site across the app and is its own round.
 * @typedef {object} Events
 * @property {string} sitzungBeendet        Path of the call that ended with 401
 * @property {undefined} passwortWechselNoetig
 * @property {undefined} zweiterFaktorPflicht  Admin without a second factor: only its setup is allowed
 * @property {undefined} setsGeaendert      Sets differ from what is shown (import finished or aborted)
 * @property {undefined} bestandGeaendert   Sets, parts and figures differ from what is shown (restore)
 * @property {{ restore?: boolean } | undefined} sammlungLaden  Reload the collection (restore: at the same spot)
 * @property {undefined} kennzahlenLaden    only the metrics above the collection
 * @property {undefined} sammlungZeichnen   redraw without a fetch (view switched)
 * @property {undefined} finanzenLaden      Reload finances (purchase or inventory changed)
 * @property {undefined} teileLaden         Reload the parts list (set deleted, parts refetched)
 * @property {object | null | undefined} setAggregat  A set's state from the server (collection tile)
 * @property {string} viewSwitched     Name of the tab or view
 * @property {undefined} filterReset
 * @property {undefined} sectionSwitched
 * @property {{ sprache: string, speichern: boolean, realSwitch: boolean }} spracheGewechselt
 */

/** @type {Map<string, Set<(data: unknown) => void>>} */
const _listeners = new Map();

/**
 * @template {keyof Events} K
 * @param {K} name
 * @param {(data: Events[K]) => void} fn
 * @returns {() => void} unsubscribes again
 */
export function subscribe(name, fn) {
  let set = _listeners.get(name);
  if (!set) {
    set = new Set();
    _listeners.set(name, set);
  }
  const listener = /** @type {(data: unknown) => void} */ (fn);
  set.add(listener);
  return () => {
    set.delete(listener);
  };
}

/**
 * An error in one listener does not hold up the rest; it goes to the catch-all for unhandled
 * errors (init.js).
 * @template {keyof Events} K
 * @param {K} name
 * @param {Events[K]} [data]
 */
export function emit(name, data) {
  for (const fn of [...(_listeners.get(name) ?? [])]) {
    try {
      fn(data);
    } catch (e) {
      setTimeout(() => {
        throw e;
      });
    }
  }
}
