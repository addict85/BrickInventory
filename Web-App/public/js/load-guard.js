// Discards late responses: each rebuild of a list starts a new generation. A response from an
// older one would arrive after a filter change and overwrite the newer list.

/** A counter per list; `whenCurrent()` only resolves with responses from the running generation. */
export function loadGuard() {
  let generation = 0;
  return {
    /** Starts a rebuild; responses from older fetches no longer count afterwards. */
    start: () => ++generation,
    /** The generation a fetch starts in right now. */
    current: () => generation,
    /** @param {number} g */
    isCurrent: g => g === generation,
    /**
     * Waits for the fetch; undefined if a rebuild has started meanwhile.
     * @template T
     * @param {Promise<T>} fetch_
     * @returns {Promise<T | undefined>}
     */
    async whenCurrent(fetch_) {
      const g = generation;
      const d = await fetch_;
      return g === generation ? d : undefined;
    },
  };
}
