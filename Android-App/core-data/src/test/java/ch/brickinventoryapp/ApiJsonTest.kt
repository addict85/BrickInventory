package ch.brickinventoryapp

import ch.brickinventoryapp.data.api.ApiJson
import ch.brickinventoryapp.data.model.LagerortVorgabeResponse
import kotlinx.serialization.SerializationException
import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Test

/**
 * Die App liest Serverantworten streng: Ein null in einem Pflichtfeld wird
 * nicht still zum Standardwert.
 *
 * Gegenprobe: in ApiJson `coerceInputValues = true` ergänzt → „null in einem
 * Feld mit Standardwert ist ein Fehler" rot (success wird still false).
 */
class ApiJsonTest {

    @Test
    fun `null in einem Feld mit Standardwert ist ein Fehler`() {
        assertThrows(SerializationException::class.java) {
            ApiJson.decodeFromString<LagerortVorgabeResponse>("""{"success":null}""")
        }
    }

    @Test
    fun `unbekannte Felder bleiben erlaubt`() {
        val r = ApiJson.decodeFromString<LagerortVorgabeResponse>("""{"success":true,"neu_vom_server":1}""")
        assertEquals(true, r.success)
    }
}
