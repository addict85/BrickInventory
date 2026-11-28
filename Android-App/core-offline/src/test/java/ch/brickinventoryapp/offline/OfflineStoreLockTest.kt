package ch.brickinventoryapp.offline

import ch.brickinventoryapp.contract.mapping.asView
import ch.brickinventoryapp.contract.testing.testSetItem
import ch.brickinventoryapp.model.local.StockKind
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.joinAll
import kotlinx.coroutines.launch
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.yield
import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * Reading, changing and writing a list run per (area, list) under one
 * lock: two writes that overtake each other otherwise lose one. The
 * stock halts the next write until the test releases it — this way the
 * second operation lies exactly in the window between reading and writing of the first.
 *
 * Counter-checks (kotlinc and JUnit against OfflineStore.kt):
 *   A  in uebernimm() and puffere() the lock removed → red “a puffere during
 *      a server response is not lost” (quantity 1 instead of 2)
 *   B  in applyChange() the lock removed → red “two simultaneous applyChange both
 *      count” (quantity 2 instead of 3)
 *   C  in OfflineStore `current` derived from `areaSource` instead of `areaFlow`
 *      → red “the observed area follows the session without anyone writing”
 */
class OfflineStoreLockTest {

    /** Halts the next write (replace or align) as soon as [hold] was called. */
    private class HoldingInventory(private val inner: LocalInventory = StorageInventory()) : LocalInventory by inner {
        private var gate: CompletableDeferred<Unit>? = null
        fun hold(): CompletableDeferred<Unit> = CompletableDeferred<Unit>().also { gate = it }

        override suspend fun replace(area: String, kind: StockKind, rows: List<LocalRow>, state: Long?) {
            gate?.let { t -> gate = null; t.await() }
            inner.replace(area, kind, rows, state)
        }

        override suspend fun syncRows(area: String, kind: StockKind, rows: List<LocalRow>) {
            gate?.let { t -> gate = null; t.await() }
            inner.syncRows(area, kind, rows)
        }
    }

    private val stock = HoldingInventory()
    private val store = OfflineStore(stock, OutboxStorage(), { "a" })

    private suspend fun quantity() = store.read(Slots.SETS)!!.list.single().quantity

    @Test
    fun `a puffere during a server response is not lost`() = runBlocking {
        store.adopt(Slots.SETS, listOf(testSetItem(setNumber = "10001-1", quantity = 1)).map { it.asView() })
        val gate = stock.hold()
        // The server doesn't know about the change yet: its response already read the
        // outbox (empty) and is waiting during the write.
        val response = launch { store.adopt(Slots.SETS, listOf(testSetItem(setNumber = "10001-1", quantity = 1)).map { it.asView() }) }
        yield()
        val offline = launch { store.buffer(Editing.SetQuantity("10001-1", 1)) }
        repeat(3) { yield() }
        gate.complete(Unit)
        joinAll(response, offline)
        assertEquals("the waiting step lies over the server answer", 2, quantity())
    }

    @Test
    fun `two simultaneous applyChange both count`() = runBlocking {
        store.adopt(Slots.SETS, listOf(testSetItem(setNumber = "10001-1", quantity = 1)).map { it.asView() })
        val gate = stock.hold()
        val first = launch { store.applyChange(Editing.SetQuantity("10001-1", 1)) }
        yield()
        val second = launch { store.applyChange(Editing.SetQuantity("10001-1", 1)) }
        repeat(3) { yield() }
        gate.complete(Unit)
        joinAll(first, second)
        assertEquals(3, quantity())
    }

    @Test
    fun `the observed area follows the session without anyone writing`() = runBlocking {
        val session = MutableStateFlow<String?>("a")
        // The point query stays at „a“: only the flow of the session is observed.
        val store = OfflineStore(StorageInventory(), OutboxStorage(), { "a" }, areaFlow = session)
        store.adopt(Slots.SETS, listOf(testSetItem(setNumber = "10001-1")).map { it.asView() })
        assertEquals(listOf("10001-1"), store.observe(Slots.SETS).first().list.map { it.setNumber })
        session.value = null
        assertEquals("signed out shows nothing", emptyList<String>(), store.observe(Slots.SETS).first().list.map { it.setNumber })
    }
}
