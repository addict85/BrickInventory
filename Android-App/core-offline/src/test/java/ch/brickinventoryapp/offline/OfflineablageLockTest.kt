package ch.brickinventoryapp.offline

import ch.brickinventoryapp.contract.mapping.alsAnsicht
import ch.brickinventoryapp.contract.SetItem
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
 * Counter-checks (kotlinc and JUnit against Offlineablage.kt):
 *   A  in uebernimm() and puffere() the lock removed → red “a puffere during
 *      a server response is not lost” (quantity 1 instead of 2)
 *   B  in applyAn() the lock removed → red “two simultaneous applyAn both
 *      count” (quantity 2 instead of 3)
 *   C  in Offlineablage `aktuell` derived from `areaSource` instead of `areaFlow`
 *      → red “the observed area follows the session without anyone writing”
 */
class OfflineablageLockTest {

    /** Halts the next write (replace or align) as soon as [hold] was called. */
    private class HoldingInventory(private val innen: LocalInventory = StorageInventory()) : LocalInventory by innen {
        private var gate: CompletableDeferred<Unit>? = null
        fun hold(): CompletableDeferred<Unit> = CompletableDeferred<Unit>().also { gate = it }

        override suspend fun ersetze(bereich: String, art: StockKind, zeilen: List<LocalRow>, stand: Long?) {
            gate?.let { t -> gate = null; t.await() }
            innen.ersetze(bereich, art, zeilen, stand)
        }

        override suspend fun sameAn(bereich: String, art: StockKind, zeilen: List<LocalRow>) {
            gate?.let { t -> gate = null; t.await() }
            innen.sameAn(bereich, art, zeilen)
        }
    }

    private val bestand = HoldingInventory()
    private val ablage = Offlineablage(bestand, StorageExit(), { "a" })

    private suspend fun menge() = ablage.lies(Slots.SETS)!!.liste.single().quantity

    @Test
    fun `a puffere during a server response is not lost`() = runBlocking {
        ablage.adopt(Slots.SETS, listOf(SetItem(setNumber = "10001-1", quantity = 1)).map { it.alsAnsicht() })
        val gate = bestand.hold()
        // The server doesn't know about the change yet: its response already read the
        // outbox (empty) and is waiting during the write.
        val antwort = launch { ablage.adopt(Slots.SETS, listOf(SetItem(setNumber = "10001-1", quantity = 1)).map { it.alsAnsicht() }) }
        yield()
        val offline = launch { ablage.buffer(Editing.SetMenge("10001-1", 1)) }
        repeat(3) { yield() }
        gate.complete(Unit)
        joinAll(antwort, offline)
        assertEquals("der wartende Schritt liegt über der Serverantwort", 2, menge())
    }

    @Test
    fun `two simultaneous applyAn both count`() = runBlocking {
        ablage.adopt(Slots.SETS, listOf(SetItem(setNumber = "10001-1", quantity = 1)).map { it.alsAnsicht() })
        val gate = bestand.hold()
        val erste = launch { ablage.applyAn(Editing.SetMenge("10001-1", 1)) }
        yield()
        val zweite = launch { ablage.applyAn(Editing.SetMenge("10001-1", 1)) }
        repeat(3) { yield() }
        gate.complete(Unit)
        joinAll(erste, zweite)
        assertEquals(3, menge())
    }

    @Test
    fun `the observed area follows the session without anyone writing`() = runBlocking {
        val sitzung = MutableStateFlow<String?>("a")
        // The point query stays at „a“: only the flow of the session is observed.
        val ablage = Offlineablage(StorageInventory(), StorageExit(), { "a" }, areaFlow = sitzung)
        ablage.adopt(Slots.SETS, listOf(SetItem(setNumber = "10001-1")).map { it.alsAnsicht() })
        assertEquals(listOf("10001-1"), ablage.observe(Slots.SETS).first().liste.map { it.setNumber })
        sitzung.value = null
        assertEquals("abgemeldet zeigt nichts", emptyList<String>(), ablage.observe(Slots.SETS).first().liste.map { it.setNumber })
    }
}
