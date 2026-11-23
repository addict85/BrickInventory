package ch.brickinventoryapp.network

import android.util.Log
import ch.brickinventoryapp.network.util.AppLog
import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Test
import java.io.ByteArrayOutputStream
import java.io.PrintStream

/**
 * Without Android, the wrapper writes to stderr: in JVM tests android.util.Log is a stub
 * that throws, since the unit tests run without isReturnDefaultValues.
 *
 * Counter-checks:
 *   log-always-logcat: default() always picks the Logcat branch → red “without Android a warning ends up …”
 *     (locally with kotlinc against android-all: UnsatisfiedLinkError from Log.w; in CI "not mocked")
 *   unit-tests-with-default-values: isReturnDefaultValues = true in the convention → red “an
 *     Android method throws …” (only measurable in CI: locally there is no android.jar from AGP)
 */
class LogWithoutAndroidTest {

    @Test
    fun `without Android a warning ends up on stderr, not in logcat`() {
        val before = System.err
        val buffer = ByteArrayOutputStream()
        System.setErr(PrintStream(buffer, true, "UTF-8"))
        try {
            AppLog.default()(AppLog.Level.WARNING, "Abmelden", "Token nicht entwertet", IllegalStateException("weg"))
            AppLog.default()(AppLog.Level.NOTE, "OkHttp", "--> GET", null)
        } finally {
            System.setErr(before)
        }
        assertEquals(
            listOf("WARNING Abmelden: Token nicht entwertet (java.lang.IllegalStateException: weg)", "NOTE OkHttp: --> GET"),
            buffer.toString("UTF-8").lines().filter { it.isNotBlank() },
        )
    }

    @Test
    fun `an Android method throws in the JVM test instead of silently returning a default value`() {
        assertThrows(Throwable::class.java) { Log.i("Probe", "ohne Robolectric") }
    }
}
