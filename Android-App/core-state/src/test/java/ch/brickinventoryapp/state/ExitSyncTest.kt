package ch.brickinventoryapp.state

import ch.brickinventoryapp.data.local.Abgleich
import ch.brickinventoryapp.data.local.Abgleichsereignis
import ch.brickinventoryapp.data.local.Abgleichsergebnis
import ch.brickinventoryapp.offline.Editing
import ch.brickinventoryapp.data.local.Bearbeitungssender
import ch.brickinventoryapp.offline.Offlineablage
import ch.brickinventoryapp.data.local.Sendeergebnis
import ch.brickinventoryapp.offline.StorageExit
import ch.brickinventoryapp.offline.StorageInventory
import ch.brickinventoryapp.data.local.classify
import ch.brickinventoryapp.data.local.deleteClassify
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
 * The outbox is sent in order; an item goes out exactly once.
 * Runs against the logic ([Abgleich], [Offlineablage]) with in-memory stores
 * and a sender that records what it receives.
 *
 * Counter-checks:
 *   A  in StorageExit.erster `minByOrNull` → `maxByOrNull` → red, among others, „eine
 *      Ablehnung verwirft …“ (sent [3, 2, 1] instead of [1, 2, 3])
 *   B  in Abgleich for Spaeter `return` left out (continues with the next one) →
 *      red „what goes later holds up everything behind it“ (FERTIG instead of LATER)
 *   C  in Abgleich the lock removed (`lock.withLock` → `run`) → red
 *      „two runs at once send nothing twice“ (sent [1, 1, 2])
 *   D  in einordnen 401 taken out of the exception list → red „eine abgelaufene
 *      Sitzung verwirft nichts“
 *   E  in Abgleich.verwirf the recording left out (gegenproben/verworfen-nicht-
 *      festgehalten.patch) → red „eine Ablehnung verwirft und hält sie fest …“
 *   (F and G measured)
 *   F  in Abgleich.lauf `p.schluessel` → `java.util.UUID.randomUUID().toString()`
 *      → red „Die Wiederholung trägt denselben Schlüssel“
 *   G  in deleteClassify the 404 exception removed → red „beim Löschen …“
 *   H  in Abgleich.lauf the scope check removed before sending → red „ein
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

    /** Store and outbox held separately: the test checks the outbox, the store doesn't show it. */
    private class Welt(bereich: suspend () -> String? = { "konto-a" }) {
        val ausgang = StorageExit()
        val ablage = Offlineablage(StorageInventory(), ausgang, bereich)
        fun sync(s: Sender) = Abgleich(ablage, ausgang, s)
    }

    private fun numbers(s: Sender) = s.gesendet.map { (it as Editing.SetMenge).setNumber.removePrefix("100").removeSuffix("-1").toInt() }

    @Test
    fun `sends in order and empties the outbox`() = runBlocking {
        val w = Welt()
        val a = w.ablage
        for (n in 1..3) a.buffer(menge(n))
        val s = Sender()
        assertEquals(Abgleichsergebnis.FERTIG, w.sync(s).send())
        assertEquals(listOf(1, 2, 3), numbers(s))
        assertEquals(0, w.ausgang.alle("konto-a").size)
    }

    @Test
    fun `what goes later holds up everything behind it`() = runBlocking {
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
    fun `a rejection discards and records it, even without an observer, the rest continues`() = runBlocking {
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
        // Only asked now: a transient event would be lost without an observer.
        val verworfen = sync.discarded().first().single()
        assertEquals("1002-1", verworfen.ziel)
        assertEquals("gibt es nicht", verworfen.meldung)
        assertTrue("Die Liste wird neu geladen, damit die lokale Annahme verschwindet: $events",
            events.any { it is Abgleichsereignis.Sent })
        assertEquals(0, w.ausgang.alle("konto-a").size)
    }

    @Test
    fun `two runs at once send nothing twice`() = runBlocking {
        val w = Welt()
        val a = w.ablage
        for (n in 1..2) a.buffer(menge(n))
        val s = Sender().apply { brake = CompletableDeferred() }
        val sync = w.sync(s)
        val erster = async { sync.send() }
        val zweiter = async { sync.send() }
        // Both runs have started, the first is hanging in sending the first item.
        repeat(5) { yield() }
        s.brake!!.complete(Unit)
        erster.await(); zweiter.await()
        assertEquals("Jeder Posten genau einmal", listOf(1, 2), numbers(s))
    }

    @Test
    fun `an expired session discards nothing`() {
        assertEquals(Sendeergebnis.Later, classify(Ergebnis.Fehler.Abgewiesen()))
        assertEquals(Sendeergebnis.Later, classify(Ergebnis.Fehler.Server(429)))
        assertEquals(Sendeergebnis.Later, classify(Ergebnis.Fehler.Server(503)))
        assertEquals(Sendeergebnis.Later, classify(Ergebnis.Fehler.Netz()))
        assertEquals(Sendeergebnis.Rejected("nein", 400), classify(Ergebnis.Fehler.Server(400, "nein")))
        assertEquals("2xx ohne Rumpf ist angekommen",
            Sendeergebnis.Angenommen, classify(Ergebnis.Fehler.LeereAntwort()))
    }

    @Test
    fun `on deleting “no longer exists” counts as arrived, anything else not`() {
        assertEquals(Sendeergebnis.Angenommen, deleteClassify(Ergebnis.Fehler.Server(404, "weg")))
        assertEquals(Sendeergebnis.Rejected("nein", 403), deleteClassify(Ergebnis.Fehler.Server(403, "nein")))
        assertEquals(Sendeergebnis.Later, deleteClassify(Ergebnis.Fehler.Netz()))
        assertEquals("ausserhalb des Löschens bleibt 404 eine Ablehnung",
            Sendeergebnis.Rejected("weg", 404), classify(Ergebnis.Fehler.Server(404, "weg")))
    }

    @Test
    fun `after too many attempts it discards instead of waiting forever`() = runBlocking {
        val w = Welt()
        val a = w.ablage
        a.buffer(menge(1))
        val s = Sender { Sendeergebnis.Later }
        repeat(Abgleich.MAX_ATTEMPTS - 1) { assertEquals(Abgleichsergebnis.LATER, w.sync(s).send()) }
        assertEquals(Abgleichsergebnis.FERTIG, w.sync(s).send())
        assertEquals(0, w.ausgang.alle("konto-a").size)
    }

    @Test
    fun `an account switch before sending sends no item with the new account`() = runBlocking {
        var konto = "konto-a"
        var switchAfterQuery = false
        val w = Welt {
            konto.also { if (switchAfterQuery) { konto = "konto-b"; switchAfterQuery = false } }
        }
        val a = w.ablage
        for (n in 1..2) a.buffer(menge(n))
        // The run starts under konto-a; before the first send, konto-b already applies.
        switchAfterQuery = true
        val s = Sender()
        assertEquals(Abgleichsergebnis.NOT_SIGNED_IN, w.sync(s).send())
        assertEquals("Kein Posten von konto-a geht mit dem Token von konto-b raus",
            emptyList<Editing>(), s.gesendet.toList())
        assertEquals(2, w.ausgang.alle("konto-a").size)
    }

    @Test
    fun `without sign-in nothing is sent`() = runBlocking {
        val w = Welt { null }
        val a = w.ablage
        val s = Sender()
        assertEquals(false, a.buffer(menge(1)))
        assertEquals(Abgleichsergebnis.NOT_SIGNED_IN, w.sync(s).send())
        assertEquals(emptyList<Editing>(), s.gesendet.toList())
    }
}
