package ch.brickinventoryapp.ui

import ch.brickinventoryapp.ui.components.strongBoxZuerst
import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Test
import java.security.ProviderException

/**
 * Der Schlüssel des Schrittschutzes und der App-Sperre entsteht zuerst im
 * StrongBox-Chip; nur wenn der Chip fehlt oder ablehnt (ProviderException, auch
 * StrongBoxUnavailableException), im TEE. Ein anderer Fehler fällt nicht still zurück.
 *
 * Gegenproben (lokal mit kotlinc gemessen):
 *   A  strongBoxZuerst() fragt gleich `erzeuge(false)` → rot „zuerst StrongBox, …“;
 *      gegenproben/geraeteschluessel-ohne-strongbox.patch
 *   B  der Rückfall fängt jede Ausnahme → rot „ein anderer Fehler …“;
 *      gegenproben/geraeteschluessel-strongbox-faengt-alles.patch
 */
class StrongBoxZuerstTest {

    @Test
    fun `zuerst StrongBox, ohne Chip das TEE`() {
        val versuche = mutableListOf<Boolean>()
        assertEquals("chip", strongBoxZuerst { s -> versuche += s; if (s) "chip" else "tee" })
        assertEquals(listOf(true), versuche)

        versuche.clear()
        val ergebnis = strongBoxZuerst { s ->
            versuche += s
            if (s) throw ProviderException("kein StrongBox") else "tee"
        }
        assertEquals("tee", ergebnis)
        assertEquals(listOf(true, false), versuche)
    }

    @Test
    fun `ein anderer Fehler des Keystores faellt nicht auf das TEE zurueck`() {
        val versuche = mutableListOf<Boolean>()
        assertThrows(IllegalStateException::class.java) {
            strongBoxZuerst<String> { s -> versuche += s; throw IllegalStateException("Keystore") }
        }
        assertEquals(listOf(true), versuche)
    }
}
