package ch.brickinventoryapp.model

import ch.brickinventoryapp.contract.AddSetRequest
import ch.brickinventoryapp.contract.Merkposten
import ch.brickinventoryapp.contract.SetItem
import ch.brickinventoryapp.model.domain.Condition
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
 *   A  serialize writes `value.name` instead of `identifier` → red “N and U go out”
 *      ("condition":"GEBRAUCHT")
 *   B  deserialize throws on unknown (`?: error(...)`) → red “an unknown
 *      condition does not discard the response”
 *   C  Zustand.aus without ignoreCase → red “lowercase counts too”
 */
class StateTest {

    private val json = Json { ignoreUnknownKeys = true; encodeDefaults = true }

    @Test
    fun `N and U go out`() {
        val text = json.encodeToString(AddSetRequest.serializer(), AddSetRequest(setNumber = "75192-1", condition = Condition.USED))
        assertTrue(text, text.contains("\"condition\":\"U\""))
        val without = json.encodeToString(AddSetRequest.serializer(), AddSetRequest(setNumber = "75192-1"))
        assertTrue(without, without.contains("\"condition\":null"))
        val remember = json.encodeToString(Merkposten.serializer(), Merkposten(setNumber = "10294-1"))
        assertTrue(remember, remember.contains("\"condition\":\"N\""))
    }

    @Test
    fun `the type comes in`() {
        val set = json.decodeFromString(SetItem.serializer(),
            """{"set_number":"75192-1","condition":"U","conditions":["N","U"]}""")
        assertEquals(Condition.USED, set.condition)
        assertEquals(listOf(Condition.NEW, Condition.USED), set.conditions)
        assertNull(json.decodeFromString(SetItem.serializer(), """{"set_number":"1-1","condition":null}""").condition)
    }

    @Test
    fun `an unknown condition does not discard the response`() {
        // Like the server (`=== 'U' ? 'U' : 'N'`): unknown counts as new.
        val set = json.decodeFromString(SetItem.serializer(),
            """{"set_number":"75192-1","condition":"X","conditions":["U","?"]}""")
        assertEquals(Condition.NEW, set.condition)
        assertEquals(listOf(Condition.USED, Condition.NEW), set.conditions)
    }

    @Test
    fun `lowercase counts too`() {
        assertEquals(Condition.USED, Condition.from("u"))
        assertEquals(Condition.NEW, Condition.from(" n "))
        assertNull(Condition.from(""))
        assertNull(Condition.from(null))
    }

    @Test
    fun `the descriptor is an enumeration type under the class name`() {
        // Navigation recognizes a route field as enum by it and loads the class via this name.
        assertEquals(Condition::class.java.name, StateSerializer.descriptor.serialName)
        assertEquals("ENUM", StateSerializer.descriptor.kind.toString())
    }
}
