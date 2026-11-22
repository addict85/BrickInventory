package ch.brickinventoryapp.data

import androidx.test.core.app.ApplicationProvider
import ch.brickinventoryapp.contract.SetItem
import ch.brickinventoryapp.contract.mapping.asView
import ch.brickinventoryapp.data.local.Reconcile
import ch.brickinventoryapp.data.local.ReconcileOutcome
import ch.brickinventoryapp.data.local.SendOutcome
import ch.brickinventoryapp.offline.Editing
import ch.brickinventoryapp.offline.OfflineStore
import ch.brickinventoryapp.offline.Outbox.DiscardedItem
import ch.brickinventoryapp.offline.Slots
import ch.brickinventoryapp.offline.testing.InMemoryRoom
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

/**
 * Sending the outbox against the real Room store: order, attempts and unreadable items
 * as the device stores them. Here in core-data, because sending lives here; the store
 * comes from core-offline's test fixtures.
 *
 * Counter-checks (measured in CI):
 *   B  in OutboxDao.all `ORDER BY id` → `ORDER BY id DESC` → “sends in order”
 *   C  in RoomOutbox.cleanUnreadable strike the rememberDiscarded → “an unreadable item is
 *      reported …” (no hint); in RoomOutbox.all remove again → same place (reading writes)
 *   D  in RoomOutbox.read `z.key` → `""` → “an unreadable item …” (key does not come back)
 */
@RunWith(RobolectricTestRunner::class)
class ReconcileOnRoomTest {

    private val room = InMemoryRoom(ApplicationProvider.getApplicationContext())
    private val stock = room.stock
    private val outbox = room.outbox

    @After
    fun tearDown() = room.close()

    @Test
    fun `sends in order and counts attempts`() = runBlocking {
        val store = OfflineStore(stock, outbox, { "a" })
        store.adopt(Slots.SETS, listOf(SetItem(setNumber = "1-1", quantity = 1)).map { it.asView() })
        for (n in 1..3) store.buffer(Editing.SetQuantity("1-1", n))
        assertEquals(3, outbox.count("a").first())
        assertEquals(7, store.read(Slots.SETS)!!.list.single().quantity)
        val sent = mutableListOf<Int>()
        var network = false
        val key = mutableSetOf<String>()
        val sync = Reconcile(store, outbox) { b, k ->
            key += k
            if (!network) SendOutcome.Later else { sent += (b as Editing.SetQuantity).step; SendOutcome.Accepted }
        }
        assertEquals(ReconcileOutcome.LATER, sync.send())
        assertEquals(1, outbox.first("a")!!.attempts)
        network = true
        assertEquals(ReconcileOutcome.DONE, sync.send())
        assertEquals(listOf(1, 2, 3), sent)
        assertEquals("der erste Posten trug bei beiden Versuchen denselben Schlüssel", 3, key.size)
        assertEquals(0, outbox.count("a").first())
    }

    @Test
    fun `an unreadable item is reported, never silently deleted, and does not block`() = runBlocking {
        room.addRawOutboxRow("a", "{\"type\":\"gibt_es_nicht\",\"setNumber\":\"10001-1\"}", created = 1, key = "k0")
        outbox.enqueue("a", Editing.SetQuantity("1-1", 1), 2, "k1")
        assertEquals(Editing.SetQuantity("1-1", 1), outbox.first("a")!!.editing)
        assertEquals("der Schlüssel kommt so zurück, wie er abgelegt wurde", "k1", outbox.first("a")!!.key)
        assertEquals(1, outbox.all("a").size)
        assertEquals("Lesen schreibt nicht: der unlesbare Posten liegt noch da", 2, outbox.count("a").first())

        val sync = Reconcile(OfflineStore(stock, outbox, { "a" }), outbox) { _, _ -> SendOutcome.Accepted }
        assertEquals(ReconcileOutcome.DONE, sync.send())
        assertEquals(listOf(DiscardedItem("k0", "10001-1", "", null, unreadable = true)), outbox.discarded("a").first())
        assertEquals(0, outbox.count("a").first())
    }
}
