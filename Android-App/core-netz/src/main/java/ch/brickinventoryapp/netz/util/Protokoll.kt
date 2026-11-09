package ch.brickinventoryapp.netz.util

import ch.brickinventoryapp.core.netz.BuildConfig

/**
 * Die einzige Stelle der App, die ins Logcat schreibt, und das nur im Debug-Build:
 * Ausnahmetexte tragen Adressen samt Abfrage, und Logcat liest jeder mit adb oder
 * einem Fehlerbericht mit. Rohes android.util.Log verbietet ProtokollTest.
 */
object Protokoll {
    enum class Stufe { NOTIZ, WARNUNG }

    /** Ob geschrieben wird; im Gerät der Debug-Schalter. Öffentlich, weil die Tests in core-data ihn umstellen. */
    @Volatile var aktiv: Boolean = BuildConfig.DEBUG

    /** Wohin; im Test eine Liste statt des Logcats. */
    @Volatile var ziel: (stufe: Stufe, tag: String, text: String, fehler: Throwable?) -> Unit =
        { stufe, tag, text, fehler ->
            if (stufe == Stufe.WARNUNG) android.util.Log.w(tag, text, fehler) else android.util.Log.i(tag, text)
        }

    fun notiz(tag: String, text: String) {
        if (aktiv) ziel(Stufe.NOTIZ, tag, text, null)
    }

    fun warnung(tag: String, text: String, fehler: Throwable? = null) {
        if (aktiv) ziel(Stufe.WARNUNG, tag, text, fehler)
    }
}
