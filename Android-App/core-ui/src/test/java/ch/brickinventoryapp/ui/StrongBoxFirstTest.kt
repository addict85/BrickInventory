package ch.brickinventoryapp.ui

import ch.brickinventoryapp.ui.components.strongBoxFirst
import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Test
import java.security.ProviderException

/**
 * The key for step protection and the app lock is created first in the
 * StrongBox chip; only if the chip is missing or refuses (ProviderException, also
 * StrongBoxUnavailableException), in the TEE. Any other error does not fall back silently.
 *
 * Counter-checks (measured locally with kotlinc):
 *   A  strongBoxFirst() asks `erzeuge(false)` directly → red „zuerst StrongBox, …“;
 *      gegenproben/geraeteschluessel-ohne-strongbox.patch
 *   B  the fallback catches every exception → red „ein anderer Fehler …“;
 *      gegenproben/geraeteschluessel-strongbox-faengt-alles.patch
 */
class StrongBoxFirstTest {

    @Test
    fun `first StrongBox, without the chip the TEE`() {
        val versuche = mutableListOf<Boolean>()
        assertEquals("chip", strongBoxFirst { s -> versuche += s; if (s) "chip" else "tee" })
        assertEquals(listOf(true), versuche)

        versuche.clear()
        val ergebnis = strongBoxFirst { s ->
            versuche += s
            if (s) throw ProviderException("kein StrongBox") else "tee"
        }
        assertEquals("tee", ergebnis)
        assertEquals(listOf(true, false), versuche)
    }

    @Test
    fun `another error of the keystore does not fall back to the TEE`() {
        val versuche = mutableListOf<Boolean>()
        assertThrows(IllegalStateException::class.java) {
            strongBoxFirst<String> { s -> versuche += s; error("Keystore") }
        }
        assertEquals(listOf(true), versuche)
    }
}
