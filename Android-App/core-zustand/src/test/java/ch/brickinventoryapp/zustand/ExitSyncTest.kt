package ch.brickinventoryapp.zustand

import ch.brickinventoryapp.data.lokal.Abgleich
import ch.brickinventoryapp.data.lokal.Abgleichsereignis
import ch.brickinventoryapp.data.lokal.Abgleichsergebnis
import ch.brickinventoryapp.offline.Editing
import ch.brickinventoryapp.data.lokal.Bearbeitungssender
import ch.brickinventoryapp.offline.Offlineablage
import ch.brickinventoryapp.data.lokal.Sendeergebnis
import ch.brickinventoryapp.offline.StorageExit
import ch.brickinventoryapp.offline.StorageInventory
import ch.brickinventoryapp.data.lokal.classify
import ch.brickinventoryapp.data.lokal.deleteClassify
import ch.brickinventoryapp.data.repository.Ergebnis
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.async
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.toList
import kotlinx.coroutines.launch
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.yield
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.util.Collections

/**
 * Der Ausgang wird der Reihe nach gesendet; ein Posten geht genau einmal raus.
 * Läuft gegen die Logik ([Abgleich], [Offlineablage]) mit Ablagen im Speicher
 * und einem Sender, der aufschreibt, was er bekommt.
 *
 * Gegenproben:
 *   A  in StorageExit.erster `minByOrNull` → `maxByOrNull` → rot u. a. „eine
 *      Ablehnung verwirft …“ (gesendet [3, 2, 1] statt [1, 2, 3])
 *   B  in Abgleich bei Spaeter `return` weggelassen (weiter mit dem nächsten) →
 *      rot „was später geht, hält alles dahinter auf“ (FERTIG statt LATER)
 *   C  in Abgleich die Sperre entfernt (`lock.withLock` → `run`) → rot
 *      „zwei Läufe zugleich senden nichts doppelt“ (gesendet [1, 1, 2])
 *   D  in einordnen 401 aus der Ausnahmeliste genommen → rot „eine abgelaufene
 *      Sitzung verwirft nichts“
 *   E  in Abgleich.verwirf das Festhalten weggelassen (gegenproben/verworfen-nicht-
 *      festgehalten.patch) → rot „eine Ablehnung verwirft und hält sie fest …“
 *   (F und G gemessen)
 *   F  in Abgleich.lauf `p.schluessel` → `java.util.UUID.randomUUID().toString()`
 *      → rot „Die Wiederholung trägt denselben Schlüssel“
 *   G  in deleteClassify die 404-Ausnahme entfernt → rot „beim Löschen …“
 *   H  in Abgleich.lauf die Bereichsprüfung vor dem Senden entfernt → rot „ein
 *      Konto-Wechsel vor dem Senden …“ (gegenproben/ausgang-ohne-pruefung-vor-senden.patch)
 */
class ExitSyncTest {

    private fun menge(n: Int) = Editing.SetMenge("100$n-1", 1)

    private class Sender(val antwort: (Editing) -> Sendeergebnis = { Sendeergebnis.Angenommen }) : Bearbeitungssender {
        val gesendet: MutableList<Editing> = Collections.synchronizedList(mutableListOf())
        val schluessel: MutableList<String> = Collections.synchronizedList(mutableListOf())
        var brake: CompletableDeferred<Unit>? = null
        override suspend fun send(b: Editing, schluessel: String): Sendeergebnis {
            gesendet += b
            this.schluessel += schluessel
            brake?.await()
            return antwort(b)
        }
    }

    /** Ablage und Ausgang getrennt in der Hand: Der Test sieht im Ausgang nach, die Ablage zeigt ihn nicht. */
    private class Welt(bereich: suspend () -> String? = { "konto-a" }) {
        val ausgang = StorageExit()
        val ablage = Offlineablage(StorageInventory(), ausgang, bereich)
        fun sync(s: Sender) = Abgleich(ablage, ausgang, s)
    }

    private fun numbers(s: Sender) = s.gesendet.map { (it as Editing.SetMenge).setNumber.removePrefix("100").removeSuffix("-1").toInt() }

    @Test
    fun `sendet der Reihe nach und leert den Ausgang`() = runBlocking {
        val w = Welt()
        val a = w.ablage
        for (n in 1..3) a.buffer(menge(n))
        val s = Sender()
        assertEquals(Abgleichsergebnis.FERTIG, w.sync(s).send())
        assertEquals(listOf(1, 2, 3), numbers(s))
        assertEquals(0, w.ausgang.alle("konto-a").size)
    }

    @Test
    fun `was später geht, hält alles dahinter auf`() = runBlocking {
        val w = Welt()
        val a = w.ablage
        for (n in 1..3) a.buffer(menge(n))
        var netz = false
        val s = Sender { if (netz) Sendeergebnis.Angenommen else Sendeergebnis.Later }
        assertEquals(Abgleichsergebnis.LATER, w.sync(s).send())
        assertEquals("Nach dem ersten „später“ darf nichts weiter raus", listOf(1), numbers(s))
        val vorn = w.ausgang.erster("konto-a")!!
        assertEquals("Der Versuch zählt", 1, vorn.versuche)
        netz = true
        assertEquals(Abgleichsergebnis.FERTIG, w.sync(s).send())
        assertEquals("Wiederholt wird derselbe Posten, dann die übrigen", listOf(1, 1, 2, 3), numbers(s))
        assertEquals("Die Wiederholung trägt denselben Schlüssel, die übrigen je einen eigenen",
            listOf(true, false, false), s.schluessel.zipWithNext { x, y -> x == y })
    }

    @Test
    fun `eine Ablehnung verwirft und hält sie fest, auch ohne Beobachter, der Rest geht weiter`() = runBlocking {
        val w = Welt()
        val a = w.ablage
        for (n in 1..3) a.buffer(menge(n))
        val s = Sender { b -> if ((b as Editing.SetMenge).setNumber == "1002-1") Sendeergebnis.Rejected("gibt es nicht", 404) else Sendeergebnis.Angenommen }
        val sync = w.sync(s)
        val events = mutableListOf<Abgleichsereignis>()
        val collector = launch { sync.events.collect { events += it } }
        yield()
        assertEquals(Abgleichsergebnis.FERTIG, sync.send())
        yield()
        collector.cancel()
        assertEquals(listOf(1, 2, 3), numbers(s))
        // Erst jetzt gefragt: Ein flüchtiges Ereignis wäre ohne Beobachter verloren.
        val verworfen = sync.discarded().first().single()
        assertEquals("1002-1", verworfen.ziel)
        assertEquals("gibt es nicht", verworfen.meldung)
        assertTrue("Die Liste wird neu geladen, damit die lokale Annahme verschwindet: $events",
            events.any { it is Abgleichsereignis.Sent })
        assertEquals(0, w.ausgang.alle("konto-a").size)
    }

    @Test
    fun `zwei Läufe zugleich senden nichts doppelt`() = runBlocking {
        val w = Welt()
        val a = w.ablage
        for (n in 1..2) a.buffer(menge(n))
        val s = Sender().apply { brake = CompletableDeferred() }
        val sync = w.sync(s)
        val erster = async { sync.send() }
        val zweiter = async { sync.send() }
        // Beide Läufe sind gestartet, der erste hängt im Senden des ersten Postens.
        repeat(5) { yield() }
        s.brake!!.complete(Unit)
        erster.await(); zweiter.await()
        assertEquals("Jeder Posten genau einmal", listOf(1, 2), numbers(s))
    }

    @Test
    fun `eine abgelaufene Sitzung verwirft nichts`() {
        assertEquals(Sendeergebnis.Later, classify(Ergebnis.Fehler.Abgewiesen()))
        assertEquals(Sendeergebnis.Later, classify(Ergebnis.Fehler.Server(429)))
        assertEquals(Sendeergebnis.Later, classify(Ergebnis.Fehler.Server(503)))
        assertEquals(Sendeergebnis.Later, classify(Ergebnis.Fehler.Netz()))
        assertEquals(Sendeergebnis.Rejected("nein", 400), classify(Ergebnis.Fehler.Server(400, "nein")))
        assertEquals("2xx ohne Rumpf ist angekommen",
            Sendeergebnis.Angenommen, classify(Ergebnis.Fehler.LeereAntwort()))
    }

    @Test
    fun `beim Löschen ist „gibt es nicht mehr“ angekommen, anderes nicht`() {
        assertEquals(Sendeergebnis.Angenommen, deleteClassify(Ergebnis.Fehler.Server(404, "weg")))
        assertEquals(Sendeergebnis.Rejected("nein", 403), deleteClassify(Ergebnis.Fehler.Server(403, "nein")))
        assertEquals(Sendeergebnis.Later, deleteClassify(Ergebnis.Fehler.Netz()))
        assertEquals("ausserhalb des Löschens bleibt 404 eine Ablehnung",
            Sendeergebnis.Rejected("weg", 404), classify(Ergebnis.Fehler.Server(404, "weg")))
    }

    @Test
    fun `nach zu vielen Versuchen wird verworfen statt ewig zu warten`() = runBlocking {
        val w = Welt()
        val a = w.ablage
        a.buffer(menge(1))
        val s = Sender { Sendeergebnis.Later }
        repeat(Abgleich.MAX_ATTEMPTS - 1) { assertEquals(Abgleichsergebnis.LATER, w.sync(s).send()) }
        assertEquals(Abgleichsergebnis.FERTIG, w.sync(s).send())
        assertEquals(0, w.ausgang.alle("konto-a").size)
    }

    @Test
    fun `ein Konto-Wechsel vor dem Senden schickt keinen Posten mit dem neuen Konto`() = runBlocking {
        var konto = "konto-a"
        var switchAfterQuery = false
        val w = Welt {
            konto.also { if (switchAfterQuery) { konto = "konto-b"; switchAfterQuery = false } }
        }
        val a = w.ablage
        for (n in 1..2) a.buffer(menge(n))
        // Der Lauf beginnt unter konto-a, vor dem ersten Senden gilt schon konto-b.
        switchAfterQuery = true
        val s = Sender()
        assertEquals(Abgleichsergebnis.NOT_SIGNED_IN, w.sync(s).send())
        assertEquals("Kein Posten von konto-a geht mit dem Token von konto-b raus",
            emptyList<Editing>(), s.gesendet.toList())
        assertEquals(2, w.ausgang.alle("konto-a").size)
    }

    @Test
    fun `ohne Anmeldung wird nichts gesendet`() = runBlocking {
        val w = Welt { null }
        val a = w.ablage
        val s = Sender()
        assertEquals(false, a.buffer(menge(1)))
        assertEquals(Abgleichsergebnis.NOT_SIGNED_IN, w.sync(s).send())
        assertEquals(emptyList<Editing>(), s.gesendet.toList())
    }
}
