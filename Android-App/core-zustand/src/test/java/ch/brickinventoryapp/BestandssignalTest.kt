package ch.brickinventoryapp

import ch.brickinventoryapp.data.model.SetAggregate
import ch.brickinventoryapp.ui.Aenderung
import ch.brickinventoryapp.ui.Bestandssignal
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch
import org.junit.Assert.assertEquals
import org.junit.Test
import java.util.Collections
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

/**
 * Das Bestandssignal verliert nichts, auch wenn ein Sammler gerade beschäftigt
 * ist, und fasst gleiche Meldungen zusammen.
 *
 * Gegenproben (29.10.2026, gemessen gegen ui/Bestandssignal.kt):
 *   A  die alte Fassung (MutableSharedFlow, extraBufferCapacity = 32, tryEmit)
 *      → rot „ein beschäftigter Sammler verliert keine Meldung“ (die 42 Meldungen
 *      kommen nie an), „je Art kommt die neueste Meldung einmal“ und „die
 *      Reihenfolge folgt der letzten Meldung“
 *   B  ohne `s.offen.remove(art)` vor dem Einfügen → rot „die Reihenfolge folgt
 *      der letzten Meldung“
 */
class BestandssignalTest {

    private class Mitschrift(signal: Bestandssignal) {
        val liste: MutableList<Aenderung> = Collections.synchronizedList(mutableListOf())
        val erstesDa = CountDownLatch(1)
        val weiter = CountDownLatch(1)
        val bereit = CountDownLatch(1)
        val scope = CoroutineScope(Dispatchers.Default)
        init {
            scope.launch {
                signal.aenderungen.collect {
                    liste += it
                    if (liste.size == 1) { erstesDa.countDown(); weiter.await() }
                }
            }
        }
        fun warteAuf(n: Int) {
            TestApi.warteBis("$n Meldungen") { liste.size >= n }
            Thread.sleep(100)
        }
    }

    /** Wartet, bis der Sammler an der ersten Meldung hängt; weitere „Alarme“ sind nur Anlauf. */
    private fun beschaeftigt(signal: Bestandssignal): Mitschrift {
        val m = Mitschrift(signal)
        TestApi.warteBis("Sammler angemeldet") { signal.melde(Aenderung.Alarme); m.erstesDa.count == 0L }
        return m
    }

    @Test
    fun `ein beschaeftigter Sammler verliert keine Meldung`() {
        val signal = Bestandssignal()
        val m = beschaeftigt(signal)
        for (i in 1..40) signal.melde(Aenderung.SetZusammenfassung(SetAggregate(setNumber = "$i-1")))
        signal.melde(Aenderung.Teile)
        m.weiter.countDown()
        m.warteAuf(42)
        val sets = m.liste.filterIsInstance<Aenderung.SetZusammenfassung>().map { it.agg.setNumber }.toSet()
        assertEquals((1..40).map { "$it-1" }.toSet(), sets)
        assertEquals(1, m.liste.count { it == Aenderung.Teile })
        m.scope.cancel()
    }

    @Test
    fun `je Art kommt die neueste Meldung einmal`() {
        val signal = Bestandssignal()
        val m = beschaeftigt(signal)
        repeat(50) { signal.melde(Aenderung.Sets) }
        for (n in 1..3) signal.melde(Aenderung.SetZusammenfassung(SetAggregate(setNumber = "75192-1", usedCount = n)))
        m.weiter.countDown()
        m.warteAuf(3)
        val nachher = m.liste.drop(1)
        assertEquals(1, nachher.count { it == Aenderung.Sets })
        assertEquals(listOf(3), nachher.filterIsInstance<Aenderung.SetZusammenfassung>().map { it.agg.usedCount })
        m.scope.cancel()
    }

    @Test
    fun `die Reihenfolge folgt der letzten Meldung`() {
        val signal = Bestandssignal()
        val m = beschaeftigt(signal)
        signal.melde(Aenderung.Sets, Aenderung.Teile)
        signal.melde(Aenderung.Sets)
        m.weiter.countDown()
        m.warteAuf(3)
        assertEquals(listOf(Aenderung.Teile, Aenderung.Sets), m.liste.drop(1).filter { it != Aenderung.Alarme })
        m.scope.cancel()
    }

    @Test
    fun `zwei Sammler bekommen jede Art`() {
        val signal = Bestandssignal()
        val a = beschaeftigt(signal)
        val b = Mitschrift(signal)
        TestApi.warteBis("zweiter Sammler") { signal.melde(Aenderung.Merkliste); b.erstesDa.count == 0L }
        b.weiter.countDown(); a.weiter.countDown()
        signal.melde(Aenderung.Figuren)
        a.warteAuf(2); b.warteAuf(2)
        for (m in listOf(a, b)) {
            assertEquals(true, m.liste.contains(Aenderung.Figuren))
            m.scope.cancel()
        }
        assertEquals(true, a.erstesDa.await(1, TimeUnit.SECONDS))
    }
}
