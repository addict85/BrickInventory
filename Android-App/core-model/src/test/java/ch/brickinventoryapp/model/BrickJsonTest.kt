package ch.brickinventoryapp.model

import ch.brickinventoryapp.model.data.model.LagerortVorgabeResponse
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
 *   B  `ignoreUnknownKeys = true` gestrichen → rot „unbekannte Felder bleiben erlaubt“
 *   C  `encodeDefaults = true` gestrichen → rot „Vorgaben werden mitgeschrieben“
 */
class BrickJsonTest {

    @Test
    fun `null in einem Feld mit Standardwert ist ein Fehler`() {
        assertThrows(SerializationException::class.java) {
            BrickJson.decodeFromString<LagerortVorgabeResponse>("""{"success":null}""")
        }
    }

    @Test
    fun `unbekannte Felder bleiben erlaubt`() {
        val r = BrickJson.decodeFromString<LagerortVorgabeResponse>("""{"success":true,"neu_vom_server":1}""")
        assertEquals(true, r.success)
    }

    @Test
    fun `Vorgaben werden mitgeschrieben`() {
        assertEquals("""{"success":false,"vorgabe":null,"error":null}""", BrickJson.encodeToString(LagerortVorgabeResponse()))
    }
}
