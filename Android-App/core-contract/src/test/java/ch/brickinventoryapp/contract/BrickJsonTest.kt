package ch.brickinventoryapp.contract

import ch.brickinventoryapp.model.json.BrickJson
import kotlinx.serialization.SerializationException
import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Test

/**
 * The one Json configuration (server, store, cache): strict on null, lenient on
 * unknown fields, defaults are written.
 *
 * Counter-checks (measured with kotlinc against core-model):
 *   A  in BrickJson `coerceInputValues = true` added → red “null in a field with
 *      a default value is an error” (success silently becomes false)
 *   B  `ignoreUnknownKeys = true` struck → red “unknown fields stay allowed”
 *   C  `encodeDefaults = true` struck → red “defaults are written along”
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
