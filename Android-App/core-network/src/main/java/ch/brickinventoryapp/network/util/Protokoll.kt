package ch.brickinventoryapp.network.util

import ch.brickinventoryapp.core.network.BuildConfig

/**
 * The app's only place that writes to Logcat, and only in a debug build:
 * exception texts carry addresses including the query string, and anyone with
 * adb or a bug report reads Logcat along with it. LogTest forbids raw android.util.Log.
 */
object Protokoll {
    enum class Stufe { NOTIZ, WARNUNG }

    /** Whether anything is written; the debug switch on the device. Public because the tests in core-data flip it. */
    @Volatile var aktiv: Boolean = BuildConfig.DEBUG

    /** Where to; in a test a list instead of Logcat. */
    @Volatile var ziel: (stufe: Stufe, tag: String, text: String, fehler: Throwable?) -> Unit = vorgabe()

    /**
     * Logcat only exists on the device (java.vm.name is "Dalvik" there, as OkHttp checks). In a
     * JVM test, android.util.Log is a throwing stub; a test should fail on its own rule, not on
     * a log line. There, the line goes to stderr instead.
     */
    internal fun vorgabe(vm: String? = System.getProperty("java.vm.name")): (Stufe, String, String, Throwable?) -> Unit =
        if (vm == "Dalvik") { stufe, tag, text, fehler ->
            if (stufe == Stufe.WARNUNG) android.util.Log.w(tag, text, fehler) else android.util.Log.i(tag, text)
        } else { stufe, tag, text, fehler ->
            System.err.println("$stufe $tag: $text" + fehler?.let { " ($it)" }.orEmpty())
        }

    fun notiz(tag: String, text: String) {
        if (aktiv) ziel(Stufe.NOTIZ, tag, text, null)
    }

    fun warnung(tag: String, text: String, fehler: Throwable? = null) {
        if (aktiv) ziel(Stufe.WARNUNG, tag, text, fehler)
    }
}
