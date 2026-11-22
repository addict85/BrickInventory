package ch.brickinventoryapp.model

import ch.brickinventoryapp.contract.AddSetRequest
import ch.brickinventoryapp.contract.Merkposten
import ch.brickinventoryapp.contract.SetItem
import ch.brickinventoryapp.model.domain.Zustand
import ch.brickinventoryapp.model.domain.StateSerializer
import kotlinx.serialization.json.Json
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The condition is a type in code and "N" or "U" on the wire. Both are checked
 * on real models: what goes out, and that unknown values do not discard the response.
 *
 * Counter-checks (performed, kotlinc + JUnit):
 *   A  serialize writes `value.name` instead of `kennung` → red “N and U go out”
 *      ("condition":"GEBRAUCHT")
 *   B  deserialize throws on unknown (`?: error(...)`) → red “an unknown
 *      condition does not discard the response”
 *   C  Zustand.aus without ignoreCase → red “lowercase counts too”
 */
class StateTest {

    private val json = Json { ignoreUnknownKeys = true; encodeDefaults = true }

    @Test
    fun `N and U go out`() {
        val text = json.encodeToString(AddSetRequest.serializer(), AddSetRequest(setNumber = "75192-1", condition = Zustand.GEBRAUCHT))
        assertTrue(text, text.contains("\"condition\":\"U\""))
        val ohne = json.encodeToString(AddSetRequest.serializer(), AddSetRequest(setNumber = "75192-1"))
        assertTrue(ohne, ohne.contains("\"condition\":null"))
        val remember = json.encodeToString(Merkposten.serializer(), Merkposten(setNumber = "10294-1"))
        assertTrue(remember, remember.contains("\"condition\":\"N\""))
    }

    @Test
    fun `the type comes in`() {
        val set = json.decodeFromString(SetItem.serializer(),
            """{"set_number":"75192-1","condition":"U","conditions":["N","U"]}""")
        assertEquals(Zustand.GEBRAUCHT, set.condition)
        assertEquals(listOf(Zustand.NEU, Zustand.GEBRAUCHT), set.conditions)
        assertNull(json.decodeFromString(SetItem.serializer(), """{"set_number":"1-1","condition":null}""").condition)
    }

    @Test
    fun `an unknown condition does not discard the response`() {
        // Like the server (`=== 'U' ? 'U' : 'N'`): unknown counts as new.
        val set = json.decodeFromString(SetItem.serializer(),
            """{"set_number":"75192-1","condition":"X","conditions":["U","?"]}""")
        assertEquals(Zustand.NEU, set.condition)
        assertEquals(listOf(Zustand.GEBRAUCHT, Zustand.NEU), set.conditions)
    }

    @Test
    fun `lowercase counts too`() {
        assertEquals(Zustand.GEBRAUCHT, Zustand.aus("u"))
        assertEquals(Zustand.NEU, Zustand.aus(" n "))
        assertNull(Zustand.aus(""))
        assertNull(Zustand.aus(null))
    }

    @Test
    fun `the descriptor is an enumeration type under the class name`() {
        // Navigation recognizes a route field as enum by it and loads the class via this name.
        assertEquals(Zustand::class.java.name, StateSerializer.descriptor.serialName)
        assertEquals("ENUM", StateSerializer.descriptor.kind.toString())
    }
}
