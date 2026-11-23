package ch.brickinventoryapp.offline

import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import ch.brickinventoryapp.contract.SetItem
import ch.brickinventoryapp.contract.mapping.asView
import ch.brickinventoryapp.model.local.StockKind
import ch.brickinventoryapp.offline.Outbox.DiscardedItem
import ch.brickinventoryapp.offline.room.InventoryDatabase
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
 *   counter-checks/store-changes-whole-list.patch (OfflineStore's change replaces the
 *      whole list again) → red “a local edit writes only the affected row”
 *   counter-checks/discarded-never-acknowledged.patch (RoomOutbox.acknowledgeDiscarded deletes nothing)
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
        assertEquals("no list of the stock sees it", emptyList<LocalRow>(), stock.read("a", StockKind.SETS).list)
        outbox.acknowledgeDiscarded("a", "k1")
        assertEquals(emptyList<DiscardedItem>(), outbox.discarded("a").first())
        outbox.rememberDiscarded("a", item.copy(id = "k2"))
        stock.empty()
        assertEquals(emptyList<DiscardedItem>(), outbox.discarded("a").first())
    }
}
