package ch.brickinventoryapp.data

import ch.brickinventoryapp.data.Netzlage.Wiederholung
import ch.brickinventoryapp.data.repository.Ergebnis
import ch.brickinventoryapp.data.repository.FigurenRepositoryImpl
import ch.brickinventoryapp.data.repository.TeileRepositoryImpl
import ch.brickinventoryapp.model.fach.Erfasst
import ch.brickinventoryapp.model.fach.Zustand
import ch.brickinventoryapp.model.fach.TeilBestand
import ch.brickinventoryapp.model.fach.Teilschluessel
import ch.brickinventoryapp.offline.Offlineablage
import ch.brickinventoryapp.offline.SpeicherAusgang
import ch.brickinventoryapp.offline.SpeicherBestand
import ch.brickinventoryapp.testing.PfadServer
import kotlinx.coroutines.runBlocking
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * Teile- und Figuren-Repository geben Fachwerte zurück: Ein `success: false` des Servers
 * ist eine Absage mit seinem Satz, der Bestand der Teileliste ist je gefragtem Teil abgelegt.
 *
 * Gegenproben (Patches unter gegenproben/):
 *   teile-absage-als-erfolg      legeLagerortAn() bildet ohne zugesagt ab → rot „ein success false …“
 *   teile-bestand-falscher-schluessel  getOwnedParts() sucht „nummer-farbe“ → rot „der Bestand …“
 *   figur-erfasst-ohne-preiszustand    addMinifig() lässt priceFromCondition weg → rot „das Erfassen …“
 */
class TeileFachwerteTest {

    @Volatile private var bereich: String? = "a"
    private val ablage = Offlineablage(SpeicherBestand(), SpeicherAusgang(), { bereich })
    private val pfade = PfadServer(
        "/api/v1/storage/locations" to """{"success":false,"error":"Den Ort gibt es schon"}""",
        "/api/v1/parts/owned" to """{"success":true,"bestand":{"3001|5":{"gesamt":7,"lose":2}}}""",
        "/api/v1/minifigs" to """{"success":true,"action":"added","fig_number":"sw0001","price_from_condition":"U"}""",
    )
    private val api = pfade.imTakt()
    private val teile = TeileRepositoryImpl(api, ablage, Wiederholung.EINMAL)
    private val figuren = FigurenRepositoryImpl(api, ablage, Wiederholung.EINMAL)

    @After
    fun zu() = pfade.server.shutdown()

    @Test
    fun `ein success false ist eine Absage mit dem Satz des Servers`() = runBlocking {
        assertEquals(Ergebnis.Fehler.Absage("Den Ort gibt es schon"), teile.legeLagerortAn("Keller"))
    }

    @Test
    fun `der Bestand steht je gefragtem Teil, was fehlt, hat keinen Eintrag`() = runBlocking {
        val r = teile.getOwnedParts(listOf(Teilschluessel("3001", 5), Teilschluessel("3002", 1)))
        assertEquals(Ergebnis.Erfolg(mapOf(Teilschluessel("3001", 5) to TeilBestand(gesamt = 7, lose = 2))), r)
    }

    @Test
    fun `das Erfassen einer Figur meldet neu und den Zustand des Kaufpreises`() = runBlocking {
        val r = figuren.addMinifig("sw0001")
        assertEquals(Ergebnis.Erfolg(Erfasst(angelegt = true, nummer = "sw0001", preisAusZustand = Zustand.GEBRAUCHT)), r)
    }
}
