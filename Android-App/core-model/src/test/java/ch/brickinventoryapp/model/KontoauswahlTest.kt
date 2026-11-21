package ch.brickinventoryapp.model

import ch.brickinventoryapp.contract.Preisalarm
import ch.brickinventoryapp.contract.PreisalarmRequest
import ch.brickinventoryapp.model.domain.Alarmrichtung
import ch.brickinventoryapp.model.domain.Kontoauswahl
import ch.brickinventoryapp.model.domain.Zustand
import kotlinx.serialization.json.Json
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/**
 * Account choice and alarm direction as domain types: what the filter saved becomes
 * the choice and again the value for `accounts=`; the direction reads and writes the
 * server's words.
 *
 * Counter-checks (gegenproben/kontoauswahl-konto-falsch.patch, alarmrichtung-ueber-falsch.patch):
 *   Konto.anfrage with prefix „konto“ → red “every saved choice becomes the same value again”
 *   UEBER with the identifier „über“ → red “the direction reads and writes the server's words”
 */
class KontoauswahlTest {

    @Test
    fun `every saved choice becomes the same value again`() {
        assertEquals(Kontoauswahl.Eigene, Kontoauswahl.aus("own"))
        assertEquals(Kontoauswahl.Unterkonten, Kontoauswahl.aus("subs"))
        assertEquals(Kontoauswahl.Konto(7), Kontoauswahl.aus(" 7 "))
        assertEquals(listOf("own", "subs", "7"), listOf("own", "subs", "7").map { Kontoauswahl.aus(it)?.anfrage })
    }

    @Test
    fun `all, empty and unreadable do not filter`() {
        assertNull(Kontoauswahl.aus("all"))
        assertNull(Kontoauswahl.aus(""))
        assertNull(Kontoauswahl.aus(null))
        assertNull(Kontoauswahl.aus("lea"))
    }

    @Test
    fun `the direction reads and writes the server's words`() {
        val json = Json { ignoreUnknownKeys = true }
        val alarm = json.decodeFromString(Preisalarm.serializer(), """{"set_number":"1-1","direction":"ueber","threshold":5.0}""")
        assertEquals(Alarmrichtung.UEBER, alarm.direction)
        assertEquals("""{"direction":"ueber","threshold":5.0,"condition":"U"}""",
            Json.encodeToString(PreisalarmRequest.serializer(), PreisalarmRequest(direction = Alarmrichtung.UEBER, threshold = 5.0, condition = Zustand.GEBRAUCHT)))
        // Unknown as at the server: „unter“, instead of discarding the list.
        assertEquals(Alarmrichtung.UNTER, json.decodeFromString(Preisalarm.serializer(), """{"direction":"seitwaerts"}""").direction)
    }
}
