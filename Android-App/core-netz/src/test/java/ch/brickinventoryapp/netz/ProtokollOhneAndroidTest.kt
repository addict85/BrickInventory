package ch.brickinventoryapp.netz

import android.util.Log
import ch.brickinventoryapp.netz.util.Protokoll
import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Test
import java.io.ByteArrayOutputStream
import java.io.PrintStream

/**
 * Ohne Android schreibt die Hülle nach stderr: In JVM-Tests ist android.util.Log eine Attrappe,
 * die wirft, seit die Unit-Tests ohne isReturnDefaultValues laufen.
 *
 * Gegenproben:
 *   protokoll-immer-logcat: vorgabe() wählt immer den Logcat-Zweig → rot „ohne Android landet …“
 *     (lokal mit kotlinc gegen android-all: UnsatisfiedLinkError aus Log.w; in der CI „not mocked“)
 *   unittests-mit-vorgabewerten: isReturnDefaultValues = true in der Konvention → rot „eine
 *     Android-Methode wirft …“ (nur in der CI messbar: lokal gibt es kein android.jar von AGP)
 */
class ProtokollOhneAndroidTest {

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
