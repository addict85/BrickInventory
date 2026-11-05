package ch.brickinventoryapp.util

import ch.brickinventoryapp.core.data.BuildConfig
import okhttp3.logging.HttpLoggingInterceptor

/**
 * Die einzige Stelle der App, die ins Logcat schreibt, und das nur im Debug-Build:
 * Ausnahmetexte tragen Adressen samt Abfrage, und Logcat liest jeder mit adb oder
 * einem Fehlerbericht mit. Rohes android.util.Log verbietet ProtokollTest.
 */
object Protokoll {
    enum class Stufe { NOTIZ, WARNUNG }

    /** Ob geschrieben wird; im Gerät der Debug-Schalter, im Test umstellbar. */
    @Volatile internal var aktiv: Boolean = BuildConfig.DEBUG

    /** Wohin; im Test eine Liste statt des Logcats. */
    @Volatile internal var ziel: (stufe: Stufe, tag: String, text: String, fehler: Throwable?) -> Unit =
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

/**
 * Der Netzmitschnitt des Debug-Builds: nur Anfrage- und Statuszeile, nie Rümpfe
 * (Passwörter, Gutschein-PINs). Die Köpfe mit Token oder Sitzung sind zusätzlich
 * geschwärzt, falls jemand beim Suchen die Stufe hochdreht.
 */
internal fun netzMitschnitt(
    schreiber: HttpLoggingInterceptor.Logger = HttpLoggingInterceptor.Logger { Protokoll.notiz("OkHttp", it) },
): HttpLoggingInterceptor = HttpLoggingInterceptor(schreiber).apply {
    level = HttpLoggingInterceptor.Level.BASIC
    redactHeader("Authorization")
    redactHeader("Cookie")
    redactHeader("Set-Cookie")
}
