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
 *   A  strongBoxFirst() asks `generate(false)` directly → red „zuerst StrongBox, …“;
 *      counter-checks/geraeteschluessel-ohne-strongbox.patch
 *   B  the fallback catches every exception → red „ein anderer Fehler …“;
 *      counter-checks/geraeteschluessel-strongbox-faengt-alles.patch
 */
class StrongBoxFirstTest {

    @Test
    fun `first StrongBox, without the chip the TEE`() {
        val attempts = mutableListOf<Boolean>()
        assertEquals("chip", strongBoxFirst { s -> attempts += s; if (s) "chip" else "tee" })
        assertEquals(listOf(true), attempts)

        attempts.clear()
        val outcome = strongBoxFirst { s ->
            attempts += s
            if (s) throw ProviderException("kein StrongBox") else "tee"
        }
        assertEquals("tee", outcome)
        assertEquals(listOf(true, false), attempts)
    }

    @Test
    fun `another error of the keystore does not fall back to the TEE`() {
        val attempts = mutableListOf<Boolean>()
        assertThrows(IllegalStateException::class.java) {
            strongBoxFirst<String> { s -> attempts += s; error("Keystore") }
        }
        assertEquals(listOf(true), attempts)
    }
}
