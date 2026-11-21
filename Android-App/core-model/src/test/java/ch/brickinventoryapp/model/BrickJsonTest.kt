package ch.brickinventoryapp.model

import ch.brickinventoryapp.contract.LagerortVorgabeResponse
import ch.brickinventoryapp.model.json.BrickJson
import kotlinx.serialization.SerializationException
import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Test

/**
 * Die eine Json-Konfiguration (Server, Ablage, Cache): streng bei null, nachsichtig bei
 * unbekannten Feldern, Vorgaben werden geschrieben.
 *
 * Gegenproben (mit kotlinc gegen core-model gemessen):
 *   A  in BrickJson `coerceInputValues = true` ergänzt → rot „null in einem Feld mit
 *      Standardwert ist ein Fehler“ (success wird still false)
 *   B  `ignoreUnknownKeys = true` gestrichen → rot „unknown fields stay allowed“
 *   C  `encodeDefaults = true` gestrichen → rot „defaults are written along“
 */
class BrickJsonTest {

    @Test
    fun `null in a field with a default value is an error`() {
        assertThrows(SerializationException::class.java) {
            BrickJson.decodeFromString<LagerortVorgabeResponse>("""{"success":null}""")
        }
    }

    @Test
    fun `unknown fields stay allowed`() {
        val r = BrickJson.decodeFromString<LagerortVorgabeResponse>("""{"success":true,"neu_vom_server":1}""")
        assertEquals(true, r.success)
    }

    @Test
    fun `defaults are written along`() {
        assertEquals("""{"success":false,"vorgabe":null}""", BrickJson.encodeToString(LagerortVorgabeResponse()))
    }
}
