/**
 * Warten in Tests, an einer Stelle. `bis()` wartet auf eine Bedingung und ist
 * die Regel; `warte(ms)` ist eine feste Pause und nur dort richtig, wo der
 * geprüfte Code selbst eine Zeitspanne verlangt (Entprellung, Sekundentakt).
 * Wie viele feste Pausen es gibt, hält test/ratschen.test.js fest.
 */

/** @param {number} ms */
const warte = (ms) => new Promise(r => setTimeout(r, ms));

/**
 * @param {() => unknown | Promise<unknown>} bedingung
 * @param {number} [ms]  höchstens so lange
 * @returns {Promise<boolean>} ob die Bedingung eintrat
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
