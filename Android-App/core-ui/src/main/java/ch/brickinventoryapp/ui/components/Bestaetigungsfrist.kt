package ch.brickinventoryapp.ui.components

/**
 * Wie lange eine Bestätigung durch die Gerätesperre gilt. Wer eben bestätigt hat,
 * wird für die nächsten Schritte (PIN aufdecken, dann kopieren) nicht erneut
 * gefragt; verlässt die App den Vordergrund, gilt sie nicht mehr ([vergiss]).
 * [clock] läuft monoton (SystemClock.elapsedRealtime), eine verstellte Uhr verlängert nichts.
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
