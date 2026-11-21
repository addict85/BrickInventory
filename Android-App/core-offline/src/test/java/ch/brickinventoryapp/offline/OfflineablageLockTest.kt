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
 * Lesen, Ändern und Schreiben einer Liste laufen je (Bereich, Liste) unter einer
 * Sperre: Zwei Schreibvorgänge, die sich überholen, verlieren sonst einen. Der
 * Bestand hält das nächste Schreiben an, bis der Test es freigibt — so liegt der
 * zweite Vorgang genau im Fenster zwischen Lesen und Schreiben des ersten.
 *
 * Gegenproben (kotlinc und JUnit gegen Offlineablage.kt):
 *   A  in uebernimm() und puffere() die Sperre entfernt → rot „ein puffere während
 *      einer Serverantwort geht nicht verloren“ (Menge 1 statt 2)
 *   B  in applyAn() die Sperre entfernt → rot „zwei gleichzeitige applyAn zählen
 *      beide“ (Menge 2 statt 3)
 *   C  in Offlineablage `aktuell` aus `areaSource` statt aus `areaFlow` abgeleitet
 *      → rot „the observed area follows the session without anyone writing“
 */
class OfflineablageLockTest {

    /** Hält das nächste Schreiben (Ersetzen oder Angleichen) an, sobald [hold] gerufen wurde. */
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
        // Der Server kennt die Änderung noch nicht: Seine Antwort hat den Ausgang
        // schon gelesen (leer) und wartet im Schreiben.
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
        // Die Punktabfrage bleibt bei „a“: Beobachtet wird allein der Fluss der Sitzung.
        val ablage = Offlineablage(StorageInventory(), StorageExit(), { "a" }, areaFlow = sitzung)
        ablage.adopt(Slots.SETS, listOf(SetItem(setNumber = "10001-1")).map { it.alsAnsicht() })
        assertEquals(listOf("10001-1"), ablage.observe(Slots.SETS).first().liste.map { it.setNumber })
        sitzung.value = null
        assertEquals("abgemeldet zeigt nichts", emptyList<String>(), ablage.observe(Slots.SETS).first().liste.map { it.setNumber })
    }
}
