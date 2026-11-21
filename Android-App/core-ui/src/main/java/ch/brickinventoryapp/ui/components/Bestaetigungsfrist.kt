package ch.brickinventoryapp.ui.components

/**
 * How long a confirmation via the screen lock stays valid. Whoever just confirmed
 * is not asked again for the next steps (reveal PIN, then copy);
 * once the app leaves the foreground, it no longer counts ([vergiss]).
 * [clock] runs monotonically (SystemClock.elapsedRealtime), a changed clock extends nothing.
 */
class Bestaetigungsfrist(private val durationMs: Long = DURATION_MS, private val clock: () -> Long) {
    private var bis: Long? = null

    fun gilt(): Boolean = bis?.let { clock() < it } == true

    fun confirmed() { bis = clock() + durationMs }

    fun vergiss() { bis = null }

    companion object {
        const val DURATION_MS = 60_000L
    }
}
