package ch.brickinventoryapp

import ch.brickinventoryapp.ui.AppUiState
import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * Der Token liegt nicht im gemeinsamen UI-Zustand: Den liest jede Oberfläche, den
 * Token braucht nur der Interceptor. Geprüft an der übersetzten Klasse.
 *
 * Gegenprobe: Feld `authToken`
 * wieder in AppUiState → rot „kein Feld von AppUiState traegt einen Token“.
 */
class KeinTokenImZustandTest {

    @Test
    fun `kein Feld von AppUiState traegt einen Token`() {
        val felder = AppUiState::class.java.declaredFields.map { it.name }
        assertEquals(emptyList<String>(), felder.filter { it.contains("token", ignoreCase = true) })
    }
}
