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
 * The local store: what is edited offline shows up in the list right away;
 * a server answer replaces the list, and whatever is still pending afterward lies
 * on top of it again. Separated per account.
 *
 * Counter-checks:
 *   A  in Offlineablage.uebernimm the loop over the outbox removed → red
 *      “a server response swallows no pending change” (quantity 1 instead of 2)
 *   B  in Offlineablage.puffere `applyAn` left out → red “what was edited offline
 *      shows up in the list right away”
 *   C  in StorageInventory.cleanOther the filter reversed → red “a different
 *      account sees none of it”
 *   D  in VouchersRepository.withoutSecret `pin = null` removed → red
 *      “a voucher lies without PIN and full number”
 */
class OfflineablageTest {

    private var konto = "a"
    private val ausgang = StorageExit()
    private val ablage = Offlineablage(StorageInventory(), ausgang, { konto })

    private fun set(nr: String, menge: Int) = SetItem(setNumber = nr, name = "Set $nr", quantity = menge)

    @Test
    fun `things edited offline are in the list immediately`() = runBlocking {
        ablage.adopt(Slots.SETS, listOf(set("10001-1", 1), set("10002-1", 3)).map { it.alsAnsicht() })
        ablage.buffer(Editing.SetMenge("10001-1", 2))
        ablage.buffer(Editing.SetErfassen(Erfassungswunsch(setNumber = "10003-1", menge = 1, zustand = Zustand.NEU)))
        val l = ablage.observe(Slots.SETS).first().liste
        assertEquals(listOf("10003-1" to 1, "10001-1" to 3, "10002-1" to 3), l.map { it.setNumber to it.quantity })
        assertEquals(2, ablage.offene().first())
    }

    @Test
    fun `a quantity of zero removes the set from the list`() = runBlocking {
        ablage.adopt(Slots.SETS, listOf(set("10001-1", 1)).map { it.alsAnsicht() })
        ablage.buffer(Editing.SetMenge("10001-1", -1))
        assertEquals(emptyList<SetItem>(), ablage.lies(Slots.SETS)!!.liste)
    }

    @Test
    fun `a server response swallows no pending change`() = runBlocking {
        ablage.adopt(Slots.SETS, listOf(set("10001-1", 1)).map { it.alsAnsicht() })
        ablage.buffer(Editing.SetMenge("10001-1", 1))
        // The server does not know about the change yet and delivers the old state.
        ablage.adopt(Slots.SETS, listOf(set("10001-1", 1).copy(name = "Neu vom Server")).map { it.alsAnsicht() })
        val s = ablage.lies(Slots.SETS)!!.liste.single()
        assertEquals(2, s.quantity)
        assertEquals("Neu vom Server", s.name)
        assertTrue("Die Serverantwort setzt den Stand", ablage.lies(Slots.SETS)!!.stand != null)
    }

    @Test
    fun `wishlist items and manual parts are created and changed locally`() = runBlocking {
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
    fun `a different account sees none of it`() = runBlocking {
        ablage.adopt(Slots.SETS, listOf(set("10001-1", 1)).map { it.alsAnsicht() })
        ablage.buffer(Editing.SetMenge("10001-1", 1))
        konto = "b"
        assertEquals(emptyList<SetItem>(), ablage.lies(Slots.SETS)!!.liste)
        assertEquals(0, ablage.offene().first())
        // As soon as account b gets something from the server, a's list is gone.
        ablage.adopt(Slots.SETS, listOf(set("30001-1", 1)).map { it.alsAnsicht() })
        konto = "a"
        assertEquals(emptyList<SetItem>(), ablage.lies(Slots.SETS)!!.liste)
    }

    @Test
    fun `sign-out empties lists and outbox`() = runBlocking {
        ablage.adopt(Slots.SETS, listOf(set("10001-1", 1)).map { it.alsAnsicht() })
        ablage.buffer(Editing.SetMenge("10001-1", 1))
        ablage.leere()
        assertEquals(emptyList<SetItem>(), ablage.lies(Slots.SETS)!!.liste)
        assertNull(ausgang.erster("a"))
    }

    @Test
    fun `a voucher lies without PIN and full number`() {
        val g = GutscheineRepositoryImpl.withoutSecret(Gutschein(id = 1, number = "1234567890123456", pin = "4711", amount = 50.0).alsAnsicht())
        assertEquals("…3456", g.number)
        assertNull(g.pin)
        assertEquals(Geld.aus(50.0), g.amount)
    }
}
