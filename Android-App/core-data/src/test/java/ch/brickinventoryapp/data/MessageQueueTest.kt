package ch.brickinventoryapp.data

import ch.brickinventoryapp.model.ui.Meldung
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
import ch.brickinventoryapp.testing.text

/**
 * Zwei Meldungen kurz nacheinander: Die zweite wartet, bis die erste quittiert
 * ist, statt sie zu ersetzen. Geschrieben wird nur über zeige() und quittiere().
 *
 * Gegenproben:
 *   meldung-ueberschreibt   zeige() setzt den Wert direkt → rot „die zweite …“
 *   meldung-doppelt         ohne Vergleich mit der letzten → rot „dieselbe …“ und
 *                           „eine Ressource bleibt …“ (mit kotlinc gemessen: dieselbe
 *                           Ressource kommt zweimal)
 */
class MessageQueueTest {

    @Test
    fun `the second message waits for the acknowledgement of the first`() {
        val kanal = MeldungsKanal()
        kanal.zeige("gespeichert")
        kanal.zeige("offline gemerkt")
        assertEquals("gespeichert", kanal.text)
        kanal.acknowledge()
        assertEquals("offline gemerkt", kanal.text)
        kanal.acknowledge()
        assertNull(kanal.text)
    }

    @Test
    fun `a resource stays a domain value until the UI shows it`() {
        val kanal = MeldungsKanal()
        kanal.zeige(Meldung.Resource(7, listOf(3)))
        kanal.zeige(Meldung.Resource(7, listOf(3)))
        kanal.zeige(Meldung.Resource(7, listOf(4)))
        assertEquals(Meldung.Resource(7, listOf(3)), kanal.meldung.value)
        kanal.acknowledge()
        assertEquals("andere Werte sind eine andere Meldung", Meldung.Resource(7, listOf(4)), kanal.meldung.value)
        kanal.acknowledge()
        assertNull(kanal.meldung.value)
    }

    @Test
    fun `the same message in a row comes once, null shows nothing`() {
        val kanal = MeldungsKanal()
        kanal.zeige(null as String?)
        assertNull(kanal.text)
        repeat(3) { kanal.zeige("Netzfehler") }
        kanal.zeige("gespeichert")
        kanal.zeige("gespeichert")
        assertEquals("Netzfehler", kanal.text)
        kanal.acknowledge()
        assertEquals("gespeichert", kanal.text)
        kanal.acknowledge()
        assertNull(kanal.text)
    }

    @Test
    fun `at most five wait, the oldest stay`() {
        val kanal = MeldungsKanal()
        (1..10).forEach { kanal.zeige("m$it") }
        val gesehen = mutableListOf<String>()
        while (true) {
            gesehen += kanal.text ?: break
            kanal.acknowledge()
        }
        assertEquals((1..6).map { "m$it" }, gesehen)
    }

    @Test
    fun `concurrent writers lose nothing`() {
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
            gesehen += kanal.text ?: break
            kanal.acknowledge()
        }
        assertEquals(setOf("t0", "t1", "t2", "t3"), gesehen)
    }
}
