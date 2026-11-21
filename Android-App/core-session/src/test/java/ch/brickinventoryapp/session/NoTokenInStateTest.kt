package ch.brickinventoryapp.session

import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * Der Token liegt nicht im gemeinsamen UI-Zustand: Den liest jede Oberfläche, den
 * Token braucht nur der Interceptor. Geprüft an der übersetzten Klasse.
 *
 * Gegenprobe: Feld `authToken`
 * wieder in AppUiState → rot „no field of AppUiState carries a token“.
 */
class NoTokenInStateTest {

    @Test
    fun `no field of AppUiState carries a token`() {
        val felder = AppUiState::class.java.declaredFields.map { it.name }
        assertEquals(emptyList<String>(), felder.filter { it.contains("token", ignoreCase = true) })
    }
}
