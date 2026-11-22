package ch.brickinventoryapp.ui.components

/**
 * How long a confirmation via the screen lock stays valid. Whoever just confirmed
 * is not asked again for the next steps (reveal PIN, then copy);
 * once the app leaves the foreground, it no longer counts ([forgetNow]).
 * [clock] runs monotonically (SystemClock.elapsedRealtime), a changed clock extends nothing.
 */
class ConfirmationDeadline(private val durationMs: Long = DURATION_MS, private val clock: () -> Long) {
    private var until: Long? = null

    fun applies(): Boolean = until?.let { clock() < it } == true

    fun confirmed() { until = clock() + durationMs }

    fun forgetNow() { until = null }

    companion object {
        const val DURATION_MS = 60_000L
    }
}
