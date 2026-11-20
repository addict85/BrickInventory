package ch.brickinventoryapp.network

import android.util.Log
import ch.brickinventoryapp.network.util.Protokoll
import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Test
import java.io.ByteArrayOutputStream
import java.io.PrintStream

/**
 * Without Android, the wrapper writes to stderr: in JVM tests android.util.Log is a stub
 * that throws, since the unit tests run without isReturnDefaultValues.
 *
 * Gegenproben:
 *   protokoll-immer-logcat: vorgabe() always picks the Logcat branch → red "ohne Android landet …"
 *     (locally with kotlinc against android-all: UnsatisfiedLinkError from Log.w; in CI "not mocked")
 *   unittests-mit-vorgabewerten: isReturnDefaultValues = true in the convention → red "eine
 *     Android-Methode wirft …" (only measurable in CI: locally there is no android.jar from AGP)
 */
class LogWithoutAndroidTest {

    @Test
    fun `ohne Android landet eine Warnung auf stderr, nicht im Logcat`() {
        val vorher = System.err
        val puffer = ByteArrayOutputStream()
        System.setErr(PrintStream(puffer, true, "UTF-8"))
        try {
            Protokoll.vorgabe()(Protokoll.Stufe.WARNUNG, "Abmelden", "Token nicht entwertet", IllegalStateException("weg"))
            Protokoll.vorgabe()(Protokoll.Stufe.NOTIZ, "OkHttp", "--> GET", null)
        } finally {
            System.setErr(vorher)
        }
        assertEquals(
            listOf("WARNUNG Abmelden: Token nicht entwertet (java.lang.IllegalStateException: weg)", "NOTIZ OkHttp: --> GET"),
            puffer.toString("UTF-8").lines().filter { it.isNotBlank() },
        )
    }

    @Test
    fun `eine Android-Methode wirft im JVM-Test, statt still einen Vorgabewert zu liefern`() {
        assertThrows(Throwable::class.java) { Log.i("Probe", "ohne Robolectric") }
    }
}
