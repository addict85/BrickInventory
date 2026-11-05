package ch.brickinventoryapp

import ch.brickinventoryapp.data.MeldungsKanal
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors

/**
 * Zwei Meldungen kurz nacheinander: Die zweite wartet, bis die erste quittiert
 * ist, statt sie zu ersetzen. Geschrieben wird nur über zeige() und quittiere().
 *
 * Gegenproben (05.11.2026, gemessen mit kotlinc lokal):
 *   meldung-ueberschreibt   zeige() setzt den Wert direkt → rot „die zweite …“
 *   meldung-doppelt         ohne Vergleich mit der letzten → rot „dieselbe …“
 */
class MeldungsWarteschlangeTest {

    @Test
    fun `die zweite Meldung wartet auf die Quittung der ersten`() {
        val kanal = MeldungsKanal()
        kanal.zeige("gespeichert")
        kanal.zeige("offline gemerkt")
        assertEquals("gespeichert", kanal.meldung.value)
        kanal.quittiere()
        assertEquals("offline gemerkt", kanal.meldung.value)
        kanal.quittiere()
        assertNull(kanal.meldung.value)
    }

    @Test
    fun `dieselbe Meldung hintereinander kommt einmal, null zeigt nichts`() {
        val kanal = MeldungsKanal()
        kanal.zeige(null)
        assertNull(kanal.meldung.value)
        repeat(3) { kanal.zeige("Netzfehler") }
        kanal.zeige("gespeichert")
        kanal.zeige("gespeichert")
        assertEquals("Netzfehler", kanal.meldung.value)
        kanal.quittiere()
        assertEquals("gespeichert", kanal.meldung.value)
        kanal.quittiere()
        assertNull(kanal.meldung.value)
    }

    @Test
    fun `es warten hoechstens fuenf, die aeltesten bleiben`() {
        val kanal = MeldungsKanal()
        (1..10).forEach { kanal.zeige("m$it") }
        val gesehen = mutableListOf<String>()
        while (true) {
            gesehen += kanal.meldung.value ?: break
            kanal.quittiere()
        }
        assertEquals((1..6).map { "m$it" }, gesehen)
    }

    @Test
    fun `gleichzeitige Schreiber verlieren nichts`() {
        val kanal = MeldungsKanal()
        val pool = Executors.newFixedThreadPool(4)
        val los = CountDownLatch(1)
        val fertig = CountDownLatch(4)
        repeat(4) { i -> pool.execute { los.await(); kanal.zeige("t$i"); fertig.countDown() } }
        los.countDown()
        fertig.await()
        pool.shutdown()
        val gesehen = mutableSetOf<String>()
        while (true) {
            gesehen += kanal.meldung.value ?: break
            kanal.quittiere()
        }
        assertEquals(setOf("t0", "t1", "t2", "t3"), gesehen)
    }
}
