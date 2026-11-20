package ch.brickinventoryapp.parts

import ch.brickinventoryapp.model.domain.Geld
import ch.brickinventoryapp.model.domain.Teilerfassung
import ch.brickinventoryapp.model.domain.Stueckaenderung
import ch.brickinventoryapp.model.domain.Merkwunsch
import ch.brickinventoryapp.model.domain.Erfassungswunsch
import ch.brickinventoryapp.contract.mapping.alsAnsicht
import ch.brickinventoryapp.model.domain.Zustand
import ch.brickinventoryapp.data.repository.GutscheineRepositoryImpl
import ch.brickinventoryapp.offline.Editing
import ch.brickinventoryapp.offline.Slots
import ch.brickinventoryapp.offline.Offlineablage
import ch.brickinventoryapp.offline.StorageExit
import ch.brickinventoryapp.offline.StorageInventory
import ch.brickinventoryapp.contract.Gutschein
import ch.brickinventoryapp.contract.Merkposten
import ch.brickinventoryapp.contract.PartValuationItem
import ch.brickinventoryapp.contract.SetItem
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
 * Gegenproben:
 *   A  in Offlineablage.uebernimm die Schleife über den Ausgang entfernt → rot
 *      „eine Serverantwort verschluckt keine wartende Änderung“ (Menge 1 statt 2)
 *   B  in Offlineablage.puffere `applyAn` weggelassen → rot „offline Bearbeitetes
 *      steht sofort in der Liste“
 *   C  in StorageInventory.cleanOther den Filter umgedreht → rot „ein anderes
 *      Konto sieht nichts davon“
 *   D  in VouchersRepository.withoutSecret `pin = null` entfernt → rot
 *      „ein Gutschein liegt ohne PIN und volle Nummer“
 */
class OfflineablageTest {

    private var konto = "a"
    private val ausgang = StorageExit()
    private val ablage = Offlineablage(StorageInventory(), ausgang, { konto })

    private fun set(nr: String, menge: Int) = SetItem(setNumber = nr, name = "Set $nr", quantity = menge)

    @Test
    fun `offline Bearbeitetes steht sofort in der Liste`() = runBlocking {
        ablage.adopt(Slots.SETS, listOf(set("10001-1", 1), set("10002-1", 3)).map { it.alsAnsicht() })
        ablage.buffer(Editing.SetMenge("10001-1", 2))
        ablage.buffer(Editing.SetErfassen(Erfassungswunsch(setNumber = "10003-1", menge = 1, zustand = Zustand.NEU)))
        val l = ablage.observe(Slots.SETS).first().liste
        assertEquals(listOf("10003-1" to 1, "10001-1" to 3, "10002-1" to 3), l.map { it.setNumber to it.quantity })
        assertEquals(2, ablage.offene().first())
    }

    @Test
    fun `eine Menge auf null nimmt das Set aus der Liste`() = runBlocking {
        ablage.adopt(Slots.SETS, listOf(set("10001-1", 1)).map { it.alsAnsicht() })
        ablage.buffer(Editing.SetMenge("10001-1", -1))
        assertEquals(emptyList<SetItem>(), ablage.lies(Slots.SETS)!!.liste)
    }

    @Test
    fun `eine Serverantwort verschluckt keine wartende Änderung`() = runBlocking {
        ablage.adopt(Slots.SETS, listOf(set("10001-1", 1)).map { it.alsAnsicht() })
        ablage.buffer(Editing.SetMenge("10001-1", 1))
        // Der Server kennt die Änderung noch nicht und liefert den alten Stand.
        ablage.adopt(Slots.SETS, listOf(set("10001-1", 1).copy(name = "Neu vom Server")).map { it.alsAnsicht() })
        val s = ablage.lies(Slots.SETS)!!.liste.single()
        assertEquals(2, s.quantity)
        assertEquals("Neu vom Server", s.name)
        assertTrue("Die Serverantwort setzt den Stand", ablage.lies(Slots.SETS)!!.stand != null)
    }

    @Test
    fun `Merkposten und manuelle Teile werden lokal angelegt und geändert`() = runBlocking {
        ablage.adopt(Slots.MERKLISTE, listOf(Merkposten(setNumber = "20001-1", condition = Zustand.NEU, userId = 7)).map { it.alsAnsicht() })
        ablage.buffer(Editing.MerkpostenAnlegen(Merkwunsch("20002-1", Zustand.GEBRAUCHT, 7)))
        ablage.buffer(Editing.MerkpostenLoeschen("20001-1", Zustand.NEU, 7))
        assertEquals(listOf("20002-1|U|7"),
            ablage.lies(Slots.MERKLISTE)!!.liste.map { "${it.setNumber}|${it.condition.kennung}|${it.userId}" })

        ablage.adopt(Slots.MANUELLE_TEILE, listOf(PartValuationItem(partNumber = "3001", colorId = 5, quantity = 4, userId = 7)).map { it.alsAnsicht() })
        ablage.buffer(Editing.TeilAendern("3001", 5, Stueckaenderung(menge = 9), 7))
        ablage.buffer(Editing.TeilErfassen(Teilerfassung(nummer = "3002", farbId = 1, menge = 2)))
        assertEquals(listOf("3002" to 2, "3001" to 9),
            ablage.lies(Slots.MANUELLE_TEILE)!!.liste.map { it.partNumber to it.quantity })
    }

    @Test
    fun `ein anderes Konto sieht nichts davon`() = runBlocking {
        ablage.adopt(Slots.SETS, listOf(set("10001-1", 1)).map { it.alsAnsicht() })
        ablage.buffer(Editing.SetMenge("10001-1", 1))
        konto = "b"
        assertEquals(emptyList<SetItem>(), ablage.lies(Slots.SETS)!!.liste)
        assertEquals(0, ablage.offene().first())
        // Sobald Konto b etwas vom Server bekommt, ist die Liste von a weg.
        ablage.adopt(Slots.SETS, listOf(set("30001-1", 1)).map { it.alsAnsicht() })
        konto = "a"
        assertEquals(emptyList<SetItem>(), ablage.lies(Slots.SETS)!!.liste)
    }

    @Test
    fun `Abmelden leert Listen und Ausgang`() = runBlocking {
        ablage.adopt(Slots.SETS, listOf(set("10001-1", 1)).map { it.alsAnsicht() })
        ablage.buffer(Editing.SetMenge("10001-1", 1))
        ablage.leere()
        assertEquals(emptyList<SetItem>(), ablage.lies(Slots.SETS)!!.liste)
        assertNull(ausgang.erster("a"))
    }

    @Test
    fun `ein Gutschein liegt ohne PIN und volle Nummer`() {
        val g = GutscheineRepositoryImpl.withoutSecret(Gutschein(id = 1, number = "1234567890123456", pin = "4711", amount = 50.0).alsAnsicht())
        assertEquals("…3456", g.number)
        assertNull(g.pin)
        assertEquals(Geld.aus(50.0), g.amount)
    }
}
