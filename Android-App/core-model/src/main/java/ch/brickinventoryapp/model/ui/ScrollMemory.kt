package ch.brickinventoryapp.model.ui

/**
 * Remembered scroll positions per tab. Lies below the UI because the state
 * (AppViewModel) holds the memory and the screens only read it: this way the
 * state layer knows no Compose module.
 */

interface ScrollMemory {
    fun read(key: String): Pair<Int, Int>
    fun track(key: String, index: Int, offset: Int)

    /** After a filter change: the old position points to entries that no longer exist. */
    fun forgetNow(key: String)
}

/** For tests without Hilt. */
fun ScrollMemory(): ScrollMemory = ScrollStorage()

/** One instance for the whole app; Hilt binds it as singleton in the state module. */
class ScrollStorage : ScrollMemory {
    private val positions = mutableMapOf<String, Pair<Int, Int>>()

    override fun read(key: String): Pair<Int, Int> = positions[key] ?: (0 to 0)

    override fun track(key: String, index: Int, offset: Int) {
        positions[key] = index to offset
    }

    override fun forgetNow(key: String) {
        positions.remove(key)
    }
}
