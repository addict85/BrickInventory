package ch.brickinventoryapp.network.util

import ch.brickinventoryapp.core.network.BuildConfig

/**
 * The app's only place that writes to Logcat, and only in a debug build:
 * exception texts carry addresses including the query string, and anyone with
 * adb or a bug report reads Logcat along with it. LogTest forbids raw android.util.Log.
 */
object AppLog {
    enum class Level { NOTE, WARNING }

    /** Whether anything is written; the debug switch on the device. Public because the tests in core-data flip it. */
    @Volatile var active: Boolean = BuildConfig.DEBUG

    /** Where to; in a test a list instead of Logcat. */
    @Volatile var target: (level: Level, tag: String, text: String, error: Throwable?) -> Unit = default()

    /**
     * Logcat only exists on the device (java.vm.name is "Dalvik" there, as OkHttp checks). In a
     * JVM test, android.util.Log is a throwing stub; a test should fail on its own rule, not on
     * a log line. There, the line goes to stderr instead.
     */
    internal fun default(vm: String? = System.getProperty("java.vm.name")): (Level, String, String, Throwable?) -> Unit =
        if (vm == "Dalvik") { level, tag, text, error ->
            if (level == Level.WARNING) android.util.Log.w(tag, text, error) else android.util.Log.i(tag, text)
        } else { level, tag, text, error ->
            System.err.println("$level $tag: $text" + error?.let { " ($it)" }.orEmpty())
        }

    fun note(tag: String, text: String) {
        if (active) target(Level.NOTE, tag, text, null)
    }

    fun warning(tag: String, text: String, error: Throwable? = null) {
        if (active) target(Level.WARNING, tag, text, error)
    }
}
