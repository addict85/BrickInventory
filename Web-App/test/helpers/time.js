/**
 * Waiting in tests, in one place. `until()` waits for a condition and is
 * the rule; `sleep(ms)` is a fixed pause and only right where the
 * checked code itself requires a time span (debouncing, one-second tick).
 * How many fixed pauses there are is recorded by test/ratschen.test.js.
 */

/** @param {number} ms */
const sleep = ms => new Promise(r => setTimeout(r, ms));

/**
 * @param {() => unknown | Promise<unknown>} condition
 * @param {number} [ms]  at most this long
 * @returns {Promise<boolean>} whether the condition occurred
 */
async function until(condition, ms = 5000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await condition()) return true;
    await sleep(10);
  }
  return !!(await condition());
}

module.exports = { sleep, until };
