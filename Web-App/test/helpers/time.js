/**
 * Waiting in tests, in one place. `bis()` waits for a condition and is
 * the rule; `warte(ms)` is a fixed pause and only right where the
 * checked code itself requires a time span (debouncing, one-second tick).
 * How many fixed pauses there are is recorded by test/ratschen.test.js.
 */

/** @param {number} ms */
const warte = ms => new Promise(r => setTimeout(r, ms));

/**
 * @param {() => unknown | Promise<unknown>} bedingung
 * @param {number} [ms]  at most this long
 * @returns {Promise<boolean>} whether the condition occurred
 */
async function bis(bedingung, ms = 5000) {
  const ende = Date.now() + ms;
  while (Date.now() < ende) {
    if (await bedingung()) return true;
    await warte(10);
  }
  return !!(await bedingung());
}

module.exports = { warte, bis };
