package ch.brickinventoryapp.offline

import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import ch.brickinventoryapp.contract.SetItem
import ch.brickinventoryapp.contract.mapping.asView
import ch.brickinventoryapp.data.local.Reconcile
import ch.brickinventoryapp.data.local.ReconcileOutcome
import ch.brickinventoryapp.data.local.SendOutcome
import ch.brickinventoryapp.model.local.StockKind
import ch.brickinventoryapp.offline.Outbox.DiscardedItem
import ch.brickinventoryapp.offline.room.InventoryDatabase
import ch.brickinventoryapp.offline.room.OutboxRow
import ch.brickinventoryapp.offline.room.RoomInventory
import ch.brickinventoryapp.offline.room.RoomOutbox
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

/**
 * The Room store itself (only in CI: Room needs Android). The same
 * promises as the in-memory stores, against a real SQLite database.
 *
 * Counter-checks: to be measured in CI as soon as the run is green —
 *   A  in InventoryDao.beobachte remove `ORDER BY position` → “keeps the order”
 *   B  in OutboxDao.alle `ORDER BY id` → `ORDER BY id DESC` → “sends in order”
 *   C  in RoomOutbox.cleanUnreadable strike the rememberDiscarded → “an unreadable item is
 *      reported …” (no hint); in RoomOutbox.alle remove again → same place (reading writes)
 *   D  in RoomOutbox.lies `z.key` → `""` → “an unreadable item …” (key does not come back)
 *   counter-checks/ablage-aendert-ganze-liste.patch (Offlineablage.aendere replaces the
 *      whole list again) → red “a local edit writes only the affected row”
 *   counter-checks/verworfen-nie-quittiert.patch (RoomOutbox.acknowledgeDiscarded deletes nothing)
 *      → red “a discarded item stays in the database until …”
 */
@RunWith(RobolectricTestRunner::class)
class InventoryDatabaseTest {

    private val db = Room.inMemoryDatabaseBuilder(ApplicationProvider.getApplicationContext(), InventoryDatabase::class.java)
        .allowMainThreadQueries().build()
    private val stock = RoomInventory(db)
    private val outbox = RoomOutbox(db)

    @After
    fun tearDown() = db.close()

    @Test
    fun `keeps the order and the state per area`() = runBlocking {
        stock.replace("a", StockKind.SETS, listOf(LocalRow("2", "{}"), LocalRow("1", "{}")), 42L)
        stock.replace("b", StockKind.SETS, listOf(LocalRow("9", "{}")), 7L)
        val a = stock.observe("a", StockKind.SETS).first()
        assertEquals(listOf("2", "1"), a.list.map { it.key })
        assertEquals(42L, a.state)
        stock.cleanOther("a")
        assertEquals(emptyList<LocalRow>(), stock.read("b", StockKind.SETS).list)
        assertNull(stock.read("b", StockKind.SETS).state)
    }

    @Test
    fun `a local change keeps the server state`() = runBlocking {
        stock.replace("a", StockKind.SETS, listOf(LocalRow("1", "{}")), 42L)
        stock.replace("a", StockKind.SETS, listOf(LocalRow("1", "{}"), LocalRow("2", "{}")), null)
        assertEquals(42L, stock.read("a", StockKind.SETS).state)
    }

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

    /** Writes every INSERT, UPDATE and DELETE on `stock` into a log table. */
    private fun writeLog(): () -> List<String> {
        val sql = db.openHelper.writableDatabase
        sql.execSQL("CREATE TABLE protokoll (was TEXT NOT NULL)")
        for (kind in listOf("INSERT", "UPDATE", "DELETE")) {
            val row = if (kind == "DELETE") "old" else "new"
            sql.execSQL("CREATE TRIGGER protokoll_$kind AFTER $kind ON stock BEGIN " +
                "INSERT INTO protokoll VALUES ('$kind ' || $row.`key`); END")
        }
        return {
            sql.query("SELECT was FROM protokoll ORDER BY rowid").use { c ->
                buildList { while (c.moveToNext()) add(c.getString(0)) }
            }
        }
    }

    @Test
    fun `a local edit writes only the affected row`() = runBlocking {
        val store = OfflineStore(stock, outbox, { "a" })
        store.adopt(Slots.SETS, listOf(SetItem(setNumber = "1-1", quantity = 1), SetItem(setNumber = "2-1", quantity = 1), SetItem(setNumber = "3-1", quantity = 1)).map { it.asView() })
        val written = writeLog()
        store.buffer(Editing.SetQuantity("2-1", 1))
        assertEquals(listOf("UPDATE 2-1"), written())
        assertEquals(listOf("1-1", "2-1", "3-1"), store.read(Slots.SETS)!!.list.map { it.setNumber })
        assertEquals(listOf(1, 2, 1), store.read(Slots.SETS)!!.list.map { it.quantity })
    }

    @Test
    fun `a discarded item stays in the database until it is acknowledged, and sign-out clears it`() = runBlocking {
        val item = DiscardedItem("k1", "10001-1", "gibt es nicht", 404)
        outbox.rememberDiscarded("a", item)
        // A second access to the same database, as after a restart of the app.
        assertEquals(listOf(item), RoomOutbox(db).discarded("a").first())
        assertEquals(emptyList<DiscardedItem>(), outbox.discarded("b").first())
        assertEquals("keine Liste des Bestands sieht ihn", emptyList<LocalRow>(), stock.read("a", StockKind.SETS).list)
        outbox.acknowledgeDiscarded("a", "k1")
        assertEquals(emptyList<DiscardedItem>(), outbox.discarded("a").first())
        outbox.rememberDiscarded("a", item.copy(id = "k2"))
        stock.empty()
        assertEquals(emptyList<DiscardedItem>(), outbox.discarded("a").first())
    }

    @Test
    fun `an unreadable item is reported, never silently deleted, and does not block`() = runBlocking {
        db.outbox().addOne(OutboxRow(area = "a", editing = "{\"type\":\"gibt_es_nicht\",\"setNumber\":\"10001-1\"}",
            created = 1, key = "k0"))
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
