package ch.brickinventoryapp.parts

import ch.brickinventoryapp.contract.SetItem
import ch.brickinventoryapp.contract.mapping.asView
import ch.brickinventoryapp.contract.testing.testPartValuationItem
import ch.brickinventoryapp.contract.testing.testSetItem
import ch.brickinventoryapp.contract.testing.testWantedItem
import ch.brickinventoryapp.model.domain.Condition
import ch.brickinventoryapp.model.domain.EntryRequest
import ch.brickinventoryapp.model.domain.PartEntry
import ch.brickinventoryapp.model.domain.QuantityChange
import ch.brickinventoryapp.model.domain.WantedRequest
import ch.brickinventoryapp.offline.Editing
import ch.brickinventoryapp.offline.OfflineStore
import ch.brickinventoryapp.offline.OutboxStorage
import ch.brickinventoryapp.offline.Slots
import ch.brickinventoryapp.offline.StorageInventory
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
 *   B  in Offlineablage.puffere `applyChange` left out → red “what was edited offline
 *      shows up in the list right away”
 *   C  in StorageInventory.cleanOther the filter reversed → red “a different
 *      account sees none of it”
 */
class OfflineStoreTest {

    private var account = "a"
    private val outbox = OutboxStorage()
    private val store = OfflineStore(StorageInventory(), outbox, { account })

    private fun set(nr: String, quantity: Int) = testSetItem(setNumber = nr, name = "Set $nr", quantity = quantity)

    @Test
    fun `things edited offline are in the list immediately`() = runBlocking {
        store.adopt(Slots.SETS, listOf(set("10001-1", 1), set("10002-1", 3)).map { it.asView() })
        store.buffer(Editing.SetQuantity("10001-1", 2))
        store.buffer(Editing.RecordSet(EntryRequest(setNumber = "10003-1", quantity = 1, condition = Condition.NEW)))
        val l = store.observe(Slots.SETS).first().list
        assertEquals(listOf("10003-1" to 1, "10001-1" to 3, "10002-1" to 3), l.map { it.setNumber to it.quantity })
        assertEquals(2, store.pending().first())
    }

    @Test
    fun `a quantity of zero removes the set from the list`() = runBlocking {
        store.adopt(Slots.SETS, listOf(set("10001-1", 1)).map { it.asView() })
        store.buffer(Editing.SetQuantity("10001-1", -1))
        assertEquals(emptyList<SetItem>(), store.read(Slots.SETS)!!.list)
    }

    @Test
    fun `a server response swallows no pending change`() = runBlocking {
        store.adopt(Slots.SETS, listOf(set("10001-1", 1)).map { it.asView() })
        store.buffer(Editing.SetQuantity("10001-1", 1))
        // The server does not know about the change yet and delivers the old state.
        store.adopt(Slots.SETS, listOf(set("10001-1", 1).copy(name = "Neu vom Server")).map { it.asView() })
        val s = store.read(Slots.SETS)!!.list.single()
        assertEquals(2, s.quantity)
        assertEquals("Neu vom Server", s.name)
        assertTrue("The server response sets the state", store.read(Slots.SETS)!!.state != null)
    }

    @Test
    fun `wishlist items and manual parts are created and changed locally`() = runBlocking {
        store.adopt(Slots.WANTED_LIST, listOf(testWantedItem(setNumber = "20001-1", condition = Condition.NEW, userId = 7)).map { it.asView() })
        store.buffer(Editing.CreateWantedItem(WantedRequest("20002-1", Condition.USED, 7)))
        store.buffer(Editing.DeleteWantedItem("20001-1", Condition.NEW, 7))
        assertEquals(listOf("20002-1|U|7"),
            store.read(Slots.WANTED_LIST)!!.list.map { "${it.setNumber}|${it.condition.identifier}|${it.userId}" })

        store.adopt(Slots.MANUAL_PARTS, listOf(testPartValuationItem(partNumber = "3001", colorId = 5, quantity = 4, userId = 7)).map { it.asView() })
        store.buffer(Editing.EditPart("3001", 5, QuantityChange(quantity = 9), 7))
        store.buffer(Editing.RecordPart(PartEntry(number = "3002", colorId = 1, quantity = 2)))
        assertEquals(listOf("3002" to 2, "3001" to 9),
            store.read(Slots.MANUAL_PARTS)!!.list.map { it.partNumber to it.quantity })
    }

    @Test
    fun `a different account sees none of it`() = runBlocking {
        store.adopt(Slots.SETS, listOf(set("10001-1", 1)).map { it.asView() })
        store.buffer(Editing.SetQuantity("10001-1", 1))
        account = "b"
        assertEquals(emptyList<SetItem>(), store.read(Slots.SETS)!!.list)
        assertEquals(0, store.pending().first())
        // As soon as account b gets something from the server, a's list is gone.
        store.adopt(Slots.SETS, listOf(set("30001-1", 1)).map { it.asView() })
        account = "a"
        assertEquals(emptyList<SetItem>(), store.read(Slots.SETS)!!.list)
    }

    @Test
    fun `sign-out empties lists and outbox`() = runBlocking {
        store.adopt(Slots.SETS, listOf(set("10001-1", 1)).map { it.asView() })
        store.buffer(Editing.SetQuantity("10001-1", 1))
        store.empty()
        assertEquals(emptyList<SetItem>(), store.read(Slots.SETS)!!.list)
        assertNull(outbox.first("a"))
    }
}
