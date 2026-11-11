package ch.brickinventoryapp.model

import ch.brickinventoryapp.model.data.model.AddSetRequest
import ch.brickinventoryapp.model.data.model.Merkposten
import ch.brickinventoryapp.model.data.model.SetItem
import ch.brickinventoryapp.model.fach.Zustand
import ch.brickinventoryapp.model.fach.ZustandSerializer
import kotlinx.serialization.json.Json
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Der Zustand ist im Code ein Typ und auf der Leitung "N" oder "U". Geprüft wird beides
 * an echten Modellen: was hinausgeht, und dass Unbekanntes die Antwort nicht verwirft.
 *
 * Gegenproben (durchgeführt, kotlinc + JUnit):
 *   A  serialize schreibt `value.name` statt `kennung` → rot „hinaus geht N und U“
 *      ("condition":"GEBRAUCHT")
 *   B  deserialize wirft bei Unbekanntem (`?: error(...)`) → rot „ein unbekannter
 *      Zustand verwirft die Antwort nicht“
 *   C  Zustand.aus ohne ignoreCase → rot „klein geschrieben gilt auch“
 */
class ZustandTest {

    private val json = Json { ignoreUnknownKeys = true; encodeDefaults = true }

    @Test
    fun `hinaus geht N und U`() {
        val text = json.encodeToString(AddSetRequest.serializer(), AddSetRequest("75192-1", condition = Zustand.GEBRAUCHT))
        assertTrue(text, text.contains("\"condition\":\"U\""))
        val ohne = json.encodeToString(AddSetRequest.serializer(), AddSetRequest("75192-1"))
        assertTrue(ohne, ohne.contains("\"condition\":null"))
        val merk = json.encodeToString(Merkposten.serializer(), Merkposten("10294-1"))
        assertTrue(merk, merk.contains("\"condition\":\"N\""))
    }

    @Test
    fun `herein kommt der Typ`() {
        val set = json.decodeFromString(SetItem.serializer(),
            """{"set_number":"75192-1","condition":"U","conditions":["N","U"]}""")
        assertEquals(Zustand.GEBRAUCHT, set.condition)
        assertEquals(listOf(Zustand.NEU, Zustand.GEBRAUCHT), set.conditions)
        assertNull(json.decodeFromString(SetItem.serializer(), """{"set_number":"1-1","condition":null}""").condition)
    }

    @Test
    fun `ein unbekannter Zustand verwirft die Antwort nicht`() {
        // Wie der Server (`=== 'U' ? 'U' : 'N'`): Unbekanntes gilt als neu.
        val set = json.decodeFromString(SetItem.serializer(),
            """{"set_number":"75192-1","condition":"X","conditions":["U","?"]}""")
        assertEquals(Zustand.NEU, set.condition)
        assertEquals(listOf(Zustand.GEBRAUCHT, Zustand.NEU), set.conditions)
    }

    @Test
    fun `klein geschrieben gilt auch`() {
        assertEquals(Zustand.GEBRAUCHT, Zustand.aus("u"))
        assertEquals(Zustand.NEU, Zustand.aus(" n "))
        assertNull(Zustand.aus(""))
        assertNull(Zustand.aus(null))
    }

    @Test
    fun `der Deskriptor ist ein Aufzaehlungstyp unter dem Klassennamen`() {
        // Navigation erkennt ein Routenfeld daran als Enum und lädt die Klasse über diesen Namen.
        assertEquals(Zustand::class.java.name, ZustandSerializer.descriptor.serialName)
        assertEquals("ENUM", ZustandSerializer.descriptor.kind.toString())
    }
}
