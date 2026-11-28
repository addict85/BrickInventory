package ch.brickinventoryapp.state

import ch.brickinventoryapp.data.local.EditingSender
import ch.brickinventoryapp.data.local.Reconcile
import ch.brickinventoryapp.data.local.ReconcileEvent
import ch.brickinventoryapp.data.local.ReconcileOutcome
import ch.brickinventoryapp.data.local.SendOutcome
import ch.brickinventoryapp.data.local.classify
import ch.brickinventoryapp.data.local.deleteClassify
import ch.brickinventoryapp.model.outcome.Outcome
import ch.brickinventoryapp.offline.Editing
import ch.brickinventoryapp.offline.OfflineStore
import ch.brickinventoryapp.offline.OutboxStorage
import ch.brickinventoryapp.offline.StorageInventory
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
 * Runs against the logic ([Reconcile], [OfflineStore]) with in-memory stores
 * and a sender that records what it receives.
 *
 * Counter-checks:
 *   A  in OutboxStorage.first `minByOrNull` → `maxByOrNull` → red, among others, „eine Ablehnung verwirft …“ (sent [3, 2, 1] instead of [1, 2, 3])
 *   B  in Abgleich for Spaeter `return` left out (continues with the next one) →
 *      red „what goes later holds up everything behind it“ (FERTIG instead of LATER)
 *   C  in Abgleich the lock removed (`lock.withLock` → `run`) → red
 *      „two runs at once send nothing twice“ (sent [1, 1, 2])
 *   D  in einordnen 401 taken out of the exception list → red „eine abgelaufene Sitzung verwirft nichts“
 *   E  in Abgleich.verwirf the recording left out (counter-checks/verworfen-nicht-
 *      festgehalten.patch) → red „eine Ablehnung verwirft und hält sie fest …“
 *   (F and G measured)
 *   F  in Reconcile.send `p.key` → `java.util.UUID.randomUUID().toString()`
 *      → red „Die Wiederholung trägt denselben Schlüssel“
 *   G  in deleteClassify the 404 exception removed → red „beim Löschen …“
 *   H  in Reconcile.send the scope check removed before sending → red „ein Konto-Wechsel vor dem Senden …“ (counter-checks/outbox-without-check-before-send.patch)
 */
class OutboxSyncTest {

    private fun quantity(n: Int) = Editing.SetQuantity("100$n-1", 1)

    private class Sender(val response: (Editing) -> SendOutcome = { SendOutcome.Accepted }) : EditingSender {
        val sent: MutableList<Editing> = Collections.synchronizedList(mutableListOf())
        val key: MutableList<String> = Collections.synchronizedList(mutableListOf())
        var brake: CompletableDeferred<Unit>? = null
        override suspend fun send(b: Editing, key: String): SendOutcome {
            sent += b
            this.key += key
            brake?.await()
            return response(b)
        }
    }

    /** Store and outbox held separately: the test checks the outbox, the store doesn't show it. */
    private class World(area: suspend () -> String? = { "konto-a" }) {
        val outbox = OutboxStorage()
        val store = OfflineStore(StorageInventory(), outbox, area)
        fun sync(s: Sender) = Reconcile(store, outbox, s)
    }

    private fun numbers(s: Sender) = s.sent.map { (it as Editing.SetQuantity).setNumber.removePrefix("100").removeSuffix("-1").toInt() }

    @Test
    fun `sends in order and empties the outbox`() = runBlocking {
        val w = World()
        val a = w.store
        for (n in 1..3) a.buffer(quantity(n))
        val s = Sender()
        assertEquals(ReconcileOutcome.DONE, w.sync(s).send())
        assertEquals(listOf(1, 2, 3), numbers(s))
        assertEquals(0, w.outbox.all("konto-a").size)
    }

    @Test
    fun `what goes later holds up everything behind it`() = runBlocking {
        val w = World()
        val a = w.store
        for (n in 1..3) a.buffer(quantity(n))
        var network = false
        val s = Sender { if (network) SendOutcome.Accepted else SendOutcome.Later }
        assertEquals(ReconcileOutcome.LATER, w.sync(s).send())
        assertEquals("after the first “later” nothing more may go out", listOf(1), numbers(s))
        val front = w.outbox.first("konto-a")!!
        assertEquals("the attempt counts", 1, front.attempts)
        network = true
        assertEquals(ReconcileOutcome.DONE, w.sync(s).send())
        assertEquals("the same item is repeated, then the others", listOf(1, 1, 2, 3), numbers(s))
        assertEquals("the repetition carries the same key, the others one of their own each",
            listOf(true, false, false), s.key.zipWithNext { x, y -> x == y })
    }

    @Test
    fun `a rejection discards and records it, even without an observer, the rest continues`() = runBlocking {
        val w = World()
        val a = w.store
        for (n in 1..3) a.buffer(quantity(n))
        val s = Sender { b -> if ((b as Editing.SetQuantity).setNumber == "1002-1") SendOutcome.Rejected("gibt es nicht", 404) else SendOutcome.Accepted }
        val sync = w.sync(s)
        val events = mutableListOf<ReconcileEvent>()
        val collector = launch { sync.events.collect { events += it } }
        yield()
        assertEquals(ReconcileOutcome.DONE, sync.send())
        yield()
        collector.cancel()
        assertEquals(listOf(1, 2, 3), numbers(s))
        // Only asked now: a transient event would be lost without an observer.
        val discarded = sync.discarded().first().single()
        assertEquals("1002-1", discarded.target)
        assertEquals("gibt es nicht", discarded.message)
        assertTrue("the list is reloaded so the local assumption disappears: $events",
            events.any { it is ReconcileEvent.Sent })
        assertEquals(0, w.outbox.all("konto-a").size)
    }

    @Test
    fun `two runs at once send nothing twice`() = runBlocking {
        val w = World()
        val a = w.store
        for (n in 1..2) a.buffer(quantity(n))
        val s = Sender().apply { brake = CompletableDeferred() }
        val sync = w.sync(s)
        val first = async { sync.send() }
        val second = async { sync.send() }
        // Both runs have started, the first is hanging in sending the first item.
        repeat(5) { yield() }
        s.brake!!.complete(Unit)
        first.await(); second.await()
        assertEquals("every item exactly once", listOf(1, 2), numbers(s))
    }

    @Test
    fun `an expired session discards nothing`() {
        assertEquals(SendOutcome.Later, classify(Outcome.Failure.Rejected()))
        assertEquals(SendOutcome.Later, classify(Outcome.Failure.Server(429)))
        assertEquals(SendOutcome.Later, classify(Outcome.Failure.Server(503)))
        assertEquals(SendOutcome.Later, classify(Outcome.Failure.Network()))
        assertEquals(SendOutcome.Rejected("nein", 400), classify(Outcome.Failure.Server(400, "nein")))
        assertEquals("2xx without a body has arrived",
            SendOutcome.Accepted, classify(Outcome.Failure.EmptyResponse()))
    }

    @Test
    fun `on deleting “no longer exists” counts as arrived, anything else not`() {
        assertEquals(SendOutcome.Accepted, deleteClassify(Outcome.Failure.Server(404, "weg")))
        assertEquals(SendOutcome.Rejected("nein", 403), deleteClassify(Outcome.Failure.Server(403, "nein")))
        assertEquals(SendOutcome.Later, deleteClassify(Outcome.Failure.Network()))
        assertEquals("outside deleting 404 stays a rejection",
            SendOutcome.Rejected("weg", 404), classify(Outcome.Failure.Server(404, "weg")))
    }

    @Test
    fun `after too many attempts it discards instead of waiting forever`() = runBlocking {
        val w = World()
        val a = w.store
        a.buffer(quantity(1))
        val s = Sender { SendOutcome.Later }
        repeat(Reconcile.MAX_ATTEMPTS - 1) { assertEquals(ReconcileOutcome.LATER, w.sync(s).send()) }
        assertEquals(ReconcileOutcome.DONE, w.sync(s).send())
        assertEquals(0, w.outbox.all("konto-a").size)
    }

    @Test
    fun `an account switch before sending sends no item with the new account`() = runBlocking {
        var account = "konto-a"
        var switchAfterQuery = false
        val w = World {
            account.also { if (switchAfterQuery) { account = "konto-b"; switchAfterQuery = false } }
        }
        val a = w.store
        for (n in 1..2) a.buffer(quantity(n))
        // The run starts under konto-a; before the first send, konto-b already applies.
        switchAfterQuery = true
        val s = Sender()
        assertEquals(ReconcileOutcome.NOT_SIGNED_IN, w.sync(s).send())
        assertEquals("no item of konto-a goes out with the token of konto-b",
            emptyList<Editing>(), s.sent.toList())
        assertEquals(2, w.outbox.all("konto-a").size)
    }

    @Test
    fun `without sign-in nothing is sent`() = runBlocking {
        val w = World { null }
        val a = w.store
        val s = Sender()
        assertEquals(false, a.buffer(quantity(1)))
        assertEquals(ReconcileOutcome.NOT_SIGNED_IN, w.sync(s).send())
        assertEquals(emptyList<Editing>(), s.sent.toList())
    }
}
