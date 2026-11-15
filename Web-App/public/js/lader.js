// Späte Antworten verwerfen: Jeder Neuaufbau einer Liste beginnt eine Generation. Eine Antwort aus
// einer älteren käme nach einem Filterwechsel an und überschriebe die neue Liste.

/** Ein Zähler je Liste; `aktuell()` liefert nur Antworten der laufenden Generation. */
export function generationen() {
  let stand = 0;
  return {
    /** Beginnt einen Neuaufbau; Antworten älterer Abrufe gelten danach nicht mehr. */
    neu: () => ++stand,
    /** Die Generation, in der ein Abruf jetzt startet. */
    jetzt: () => stand,
    /** @param {number} g */
    gilt: g => g === stand,
    /**
     * Wartet auf den Abruf; undefined, wenn inzwischen neu aufgebaut wurde.
     * @template T
     * @param {Promise<T>} abruf
     * @returns {Promise<T | undefined>}
     */
    async aktuell(abruf) {
      const g = stand;
      const d = await abruf;
      return g === stand ? d : undefined;
    },
  };
}
