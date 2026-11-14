package ch.brickinventoryapp.model

import ch.brickinventoryapp.vertrag.Preisalarm
import ch.brickinventoryapp.vertrag.PreisalarmRequest
import ch.brickinventoryapp.model.fach.Alarmrichtung
import ch.brickinventoryapp.model.fach.Kontoauswahl
import ch.brickinventoryapp.model.fach.Zustand
import kotlinx.serialization.json.Json
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/**
 * Kontowahl und Alarmrichtung als Fachtypen: Was der Filter gespeichert hat, wird
 * zur Wahl und wieder zum Wert für `accounts=`; die Richtung liest und schreibt die
 * Wörter des Servers.
 *
 * Gegenproben (gegenproben/kontoauswahl-konto-falsch.patch, alarmrichtung-ueber-falsch.patch):
 *   Konto.anfrage mit Vorsatz „konto“ → rot „jede gespeicherte Wahl wird wieder derselbe Wert“
 *   UEBER mit der Kennung „über“ → rot „die Richtung liest und schreibt die Wörter des Servers“
 */
class KontoauswahlTest {

    @Test
    fun `jede gespeicherte Wahl wird wieder derselbe Wert`() {
        assertEquals(Kontoauswahl.Eigene, Kontoauswahl.aus("own"))
        assertEquals(Kontoauswahl.Unterkonten, Kontoauswahl.aus("subs"))
        assertEquals(Kontoauswahl.Konto(7), Kontoauswahl.aus(" 7 "))
        assertEquals(listOf("own", "subs", "7"), listOf("own", "subs", "7").map { Kontoauswahl.aus(it)?.anfrage })
    }

    @Test
    fun `alle, leer und Unlesbares filtern nicht`() {
        assertNull(Kontoauswahl.aus("all"))
        assertNull(Kontoauswahl.aus(""))
        assertNull(Kontoauswahl.aus(null))
        assertNull(Kontoauswahl.aus("lea"))
    }

    @Test
    fun `die Richtung liest und schreibt die Woerter des Servers`() {
        val json = Json { ignoreUnknownKeys = true }
        val alarm = json.decodeFromString(Preisalarm.serializer(), """{"set_number":"1-1","richtung":"ueber","schwelle":5.0}""")
        assertEquals(Alarmrichtung.UEBER, alarm.richtung)
        assertEquals("""{"richtung":"ueber","schwelle":5.0,"condition":"U"}""",
            Json.encodeToString(PreisalarmRequest.serializer(), PreisalarmRequest(Alarmrichtung.UEBER, 5.0, Zustand.GEBRAUCHT)))
        // Unbekanntes wie beim Server: „unter“, statt die Liste zu verwerfen.
        assertEquals(Alarmrichtung.UNTER, json.decodeFromString(Preisalarm.serializer(), """{"richtung":"seitwaerts"}""").richtung)
    }
}
