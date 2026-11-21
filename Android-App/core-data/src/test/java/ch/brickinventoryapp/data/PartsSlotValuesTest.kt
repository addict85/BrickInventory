package ch.brickinventoryapp.data

import ch.brickinventoryapp.data.Netzlage.Wiederholung
import ch.brickinventoryapp.data.repository.Ergebnis
import ch.brickinventoryapp.data.repository.FigurenRepositoryImpl
import ch.brickinventoryapp.data.repository.TeileRepositoryImpl
import ch.brickinventoryapp.model.domain.Erfasst
import ch.brickinventoryapp.model.domain.Zustand
import ch.brickinventoryapp.model.domain.PartInventory
import ch.brickinventoryapp.model.domain.PartialKey
import ch.brickinventoryapp.offline.Offlineablage
import ch.brickinventoryapp.offline.StorageExit
import ch.brickinventoryapp.offline.StorageInventory
import ch.brickinventoryapp.testing.PfadServer
import kotlinx.coroutines.runBlocking
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * Teile- und Figuren-Repository geben Fachwerte zurück: Ein `success: false` des Servers
 * ist eine Absage (ihren Satz schickt er mit einem Fehlerstatus), der Bestand der Teileliste ist je gefragtem Teil abgelegt.
 *
 * Gegenproben (Patches unter gegenproben/):
 *   teile-absage-als-erfolg      putLocationAn() bildet ohne zugesagt ab → rot „ein success false …“
 *   teile-bestand-falscher-schluessel  getOwnedParts() sucht „nummer-farbe“ → rot „der Bestand …“
 *   figur-erfasst-ohne-preiszustand    addMinifig() lässt priceFromCondition weg → rot „das Erfassen …“
 */
class PartsSlotValuesTest {

    @Volatile private var bereich: String? = "a"
    private val ablage = Offlineablage(StorageInventory(), StorageExit(), { bereich })
    private val paths = PfadServer(
        "/api/v1/storage/locations" to """{"success":false}""",
        "/api/v1/parts/owned" to """{"success":true,"bestand":{"3001|5":{"gesamt":7,"lose":2}}}""",
        "/api/v1/minifigs" to """{"success":true,"action":"added","fig_number":"sw0001","price_from_condition":"U"}""",
    )
    private val api = paths.imTakt()
    private val teile = TeileRepositoryImpl(api, ablage, Wiederholung.EINMAL)
    private val figuren = FigurenRepositoryImpl(api, ablage, Wiederholung.EINMAL)

    @After
    fun zu() = paths.server.shutdown()

    @Test
    fun `a success false is a refusal`() = runBlocking {
        assertEquals(Ergebnis.Fehler.Absage(), teile.putLocationAn("Keller"))
    }

    @Test
    fun `the stock is listed per requested part, what is missing has no entry`() = runBlocking {
        val r = teile.getOwnedParts(listOf(PartialKey("3001", 5), PartialKey("3002", 1)))
        assertEquals(Ergebnis.Erfolg(mapOf(PartialKey("3001", 5) to PartInventory(gesamt = 7, lose = 2))), r)
    }

    @Test
    fun `adding a figure reports new and the state of the purchase price`() = runBlocking {
        val r = figuren.addMinifig("sw0001")
        assertEquals(Ergebnis.Erfolg(Erfasst(angelegt = true, nummer = "sw0001", priceFromState = Zustand.GEBRAUCHT)), r)
    }
}
