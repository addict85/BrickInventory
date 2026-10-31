package ch.brickinventoryapp

import ch.brickinventoryapp.data.lokal.Bearbeitung
import ch.brickinventoryapp.data.lokal.Faecher
import ch.brickinventoryapp.data.lokal.Offlineablage
import ch.brickinventoryapp.data.lokal.SpeicherAusgang
import ch.brickinventoryapp.data.lokal.SpeicherBestand
import ch.brickinventoryapp.data.model.AddPartRequest
import ch.brickinventoryapp.data.model.AddSetRequest
import ch.brickinventoryapp.data.model.Gutschein
import ch.brickinventoryapp.data.model.MerkpostenRequest
import ch.brickinventoryapp.data.model.Merkposten
import ch.brickinventoryapp.data.model.PartValuationItem
import ch.brickinventoryapp.data.model.SetItem
import ch.brickinventoryapp.data.model.UpdateManualItemRequest
import ch.brickinventoryapp.data.repository.GutscheineRepository
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Die lokale Ablage: Was offline bearbeitet wird, steht sofort in der Liste;
 * eine Serverantwort ersetzt die Liste, und was noch wartet, liegt danach
 * wieder darüber. Je Konto getrennt.
 *
 * Gegenproben (30.10.2026, gemessen):
 *   A  in Offlineablage.uebernimm die Schleife über den Ausgang entfernt → rot
 *      „eine Serverantwort verschluckt keine wartende Änderung“ (Menge 1 statt 2)
 *   B  in Offlineablage.puffere `wendeAn` weggelassen → rot „offline Bearbeitetes
 *      steht sofort in der Liste“
 *   C  in SpeicherBestand.raeumeAndere den Filter umgedreht → rot „ein anderes
 *      Konto sieht nichts davon“
 *   D  in GutscheineRepository.ohneGeheimnis `pin = null` entfernt → rot
 *      „ein Gutschein liegt ohne PIN und volle Nummer“
 */
class OfflineablageTest {

    private var konto = "a"
    private val ablage = Offlineablage(SpeicherBestand(), SpeicherAusgang(), { konto })

    private fun set(nr: String, menge: Int) = SetItem(setNumber = nr, name = "Set $nr", quantity = menge)

    @Test
    fun `offline Bearbeitetes steht sofort in der Liste`() = runBlocking {
        ablage.uebernimm(Faecher.SETS, listOf(set("10001-1", 1), set("10002-1", 3)))
        ablage.puffere(Bearbeitung.SetMenge("10001-1", 2))
        ablage.puffere(Bearbeitung.SetErfassen(AddSetRequest("10003-1", quantity = 1, condition = "N")))
        val l = ablage.beobachte(Faecher.SETS).first().liste
        assertEquals(listOf("10003-1" to 1, "10001-1" to 3, "10002-1" to 3), l.map { it.setNumber to it.quantity })
        assertEquals(2, ablage.offene().first())
    }

    @Test
    fun `eine Menge auf null nimmt das Set aus der Liste`() = runBlocking {
        ablage.uebernimm(Faecher.SETS, listOf(set("10001-1", 1)))
        ablage.puffere(Bearbeitung.SetMenge("10001-1", -1))
        assertEquals(emptyList<SetItem>(), ablage.lies(Faecher.SETS)!!.liste)
    }

    @Test
    fun `eine Serverantwort verschluckt keine wartende Änderung`() = runBlocking {
        ablage.uebernimm(Faecher.SETS, listOf(set("10001-1", 1)))
        ablage.puffere(Bearbeitung.SetMenge("10001-1", 1))
        // Der Server kennt die Änderung noch nicht und liefert den alten Stand.
        ablage.uebernimm(Faecher.SETS, listOf(set("10001-1", 1).copy(name = "Neu vom Server")))
        val s = ablage.lies(Faecher.SETS)!!.liste.single()
        assertEquals(2, s.quantity)
        assertEquals("Neu vom Server", s.name)
        assertTrue("Die Serverantwort setzt den Stand", ablage.lies(Faecher.SETS)!!.stand != null)
    }

    @Test
    fun `Merkposten und manuelle Teile werden lokal angelegt und geändert`() = runBlocking {
        ablage.uebernimm(Faecher.MERKLISTE, listOf(Merkposten(setNumber = "20001-1", condition = "N", userId = 7)))
        ablage.puffere(Bearbeitung.MerkpostenAnlegen(MerkpostenRequest("20002-1", "U", 7)))
        ablage.puffere(Bearbeitung.MerkpostenLoeschen("20001-1", "N", 7))
        assertEquals(listOf("20002-1|U|7"),
            ablage.lies(Faecher.MERKLISTE)!!.liste.map { "${it.setNumber}|${it.condition}|${it.userId}" })

        ablage.uebernimm(Faecher.MANUELLE_TEILE, listOf(PartValuationItem(partNumber = "3001", colorId = 5, quantity = 4, userId = 7)))
        ablage.puffere(Bearbeitung.TeilAendern("3001", 5, UpdateManualItemRequest(quantity = 9), 7))
        ablage.puffere(Bearbeitung.TeilErfassen(AddPartRequest("3002", colorId = 1, quantity = 2)))
        assertEquals(listOf("3002" to 2, "3001" to 9),
            ablage.lies(Faecher.MANUELLE_TEILE)!!.liste.map { it.partNumber to it.quantity })
    }

    @Test
    fun `ein anderes Konto sieht nichts davon`() = runBlocking {
        ablage.uebernimm(Faecher.SETS, listOf(set("10001-1", 1)))
        ablage.puffere(Bearbeitung.SetMenge("10001-1", 1))
        konto = "b"
        assertEquals(emptyList<SetItem>(), ablage.lies(Faecher.SETS)!!.liste)
        assertEquals(0, ablage.offene().first())
        // Sobald Konto b etwas vom Server bekommt, ist die Liste von a weg.
        ablage.uebernimm(Faecher.SETS, listOf(set("30001-1", 1)))
        konto = "a"
        assertEquals(emptyList<SetItem>(), ablage.lies(Faecher.SETS)!!.liste)
    }

    @Test
    fun `Abmelden leert Listen und Ausgang`() = runBlocking {
        ablage.uebernimm(Faecher.SETS, listOf(set("10001-1", 1)))
        ablage.puffere(Bearbeitung.SetMenge("10001-1", 1))
        ablage.leere()
        assertEquals(emptyList<SetItem>(), ablage.lies(Faecher.SETS)!!.liste)
        assertNull(ablage.ausgang.erster("a"))
    }

    @Test
    fun `ein Gutschein liegt ohne PIN und volle Nummer`() {
        val g = GutscheineRepository.ohneGeheimnis(Gutschein(id = 1, number = "1234567890123456", pin = "4711", amount = 50.0))
        assertEquals("…3456", g.number)
        assertNull(g.pin)
        assertEquals(50.0, g.amount, 0.0)
    }
}
