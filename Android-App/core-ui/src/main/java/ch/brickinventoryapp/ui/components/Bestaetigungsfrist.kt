package ch.brickinventoryapp.ui.components

/**
 * Wie lange eine Bestätigung durch die Gerätesperre gilt. Wer eben bestätigt hat,
 * wird für die nächsten Schritte (PIN aufdecken, dann kopieren) nicht erneut
 * gefragt; verlässt die App den Vordergrund, gilt sie nicht mehr ([vergiss]).
 * [uhr] läuft monoton (SystemClock.elapsedRealtime), eine verstellte Uhr verlängert nichts.
 */
class Bestaetigungsfrist(private val dauerMs: Long = DAUER_MS, private val uhr: () -> Long) {
    private var bis: Long? = null

    fun gilt(): Boolean = bis?.let { uhr() < it } == true

    fun bestaetigt() { bis = uhr() + dauerMs }

    fun vergiss() { bis = null }

    companion object {
        const val DAUER_MS = 60_000L
    }
}
