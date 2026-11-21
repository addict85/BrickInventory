package ch.brickinventoryapp.model.ui

/**
 * Remembered scroll positions per tab. Lies below the UI because the state
 * (AppViewModel) holds the memory and the screens only read it: this way the
 * state layer knows no Compose module.
 */

interface ScrollMemory {
    fun lies(schluessel: String): Pair<Int, Int>
    fun merke(schluessel: String, index: Int, offset: Int)

    /** After a filter change: the old position points to entries that no longer exist. */
    fun vergiss(schluessel: String)
}

/** For tests without Hilt. */
fun ScrollMemory(): ScrollMemory = ScrollStorage()

/** One instance for the whole app; Hilt binds it as singleton in the state module. */
class ScrollStorage : ScrollMemory {
    private val positionen = mutableMapOf<String, Pair<Int, Int>>()

    override fun lies(schluessel: String): Pair<Int, Int> = positionen[schluessel] ?: (0 to 0)

    override fun merke(schluessel: String, index: Int, offset: Int) {
        positionen[schluessel] = index to offset
    }

    override fun vergiss(schluessel: String) {
        positionen.remove(schluessel)
    }
}
