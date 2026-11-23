package ch.brickinventoryapp.state

import ch.brickinventoryapp.data.MessageChannel
import ch.brickinventoryapp.data.local.Baseline
import ch.brickinventoryapp.data.local.Baseline.DiscardedChange
import ch.brickinventoryapp.data.local.ReconcileEvent
import ch.brickinventoryapp.data.testing.FakeApi
import ch.brickinventoryapp.data.testing.TestStore
import ch.brickinventoryapp.data.testing.testStockReconciliation
import ch.brickinventoryapp.model.local.StockKind
import ch.brickinventoryapp.model.ui.Message
import ch.brickinventoryapp.resources.R
import ch.brickinventoryapp.state.ui.InitialObserver
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * The outbox is visible: count and hint as soon as something has been stored
 * offline; the affected lists' server state into the store once something
 * was sent; a message with a reason if the server rejected it.
 *
 * Counter-checks:
 *   A  in OutboxNotifier.launch the hint on a rising count removed → red
 *      „offline Gespeichertes wird gemeldet“
 *   B  for MANUAL_PARTS `null` instead of Liste.TEILE → red „gesendet holt die betroffenen Listen in die Ablage“
 *   C  `e.message` instead of `e.message.ifBlank { … }` → red „ohne Grund vom Server steht ein eigener Satz da“
 *   D  `situation.planeLeftover()` left out at startup → red „was vom letzten Mal wartet, wird beim Start eingeplant“
 *   E  in InitialObserver.launch the check `started` removed → red „ein zweiter Start folgt dem Ausgang nicht doppelt“ (2 instead of 1)
 *   F  in reportDiscarded the check `v.unreadable` removed → red „ein nach dem Update unlesbarer Posten wird als solcher gemeldet“ (only measurable in CI)
 *   (B, D and E measured locally with kotlinc)
 *   counter-checks/discarded-acknowledged-immediately.patch (reportDiscarded acknowledges right after
 *      show) → red „ein Verworfenes bleibt, bis sein Hinweis weggeräumt ist“
 */
@OptIn(ExperimentalCoroutinesApi::class)
class OutboxNotifierTest {

    /** The outbox as seen from outside, without a store: the test sets count, events and discarded items. */
    private class State : Baseline {
        val number = MutableStateFlow(0)
        val reported = MutableSharedFlow<ReconcileEvent>(extraBufferCapacity = 4)
        val discarded = MutableStateFlow<List<DiscardedChange>>(emptyList())
        var scheduled = 0
        override fun pending() = number
        override val events = reported
        override fun discarded() = discarded
        override suspend fun acknowledge(v: DiscardedChange) { discarded.value = discarded.value - v }
        override suspend fun planeLeftover() { scheduled++ }
    }

    @Test
    fun `things saved offline are reported, sent reloads, rejected says why`() = runTest {
        val situation = State()
        val fake = FakeApi()
        val channel = MessageChannel()
        val notifier = InitialObserver(situation, testStockReconciliation(fake.api, TestStore()), channel)
        notifier.launch(backgroundScope)
        runCurrent()
        assertEquals("what waits from last time is scheduled at start", 1, situation.scheduled)

        situation.number.value = 1
        runCurrent()
        assertEquals(1, notifier.pending.value)
        assertEquals("what was saved offline is reported", Message.Quantity(R.plurals.offline_outbox, 1), channel.message.value)

        situation.reported.emit(ReconcileEvent.Sent(setOf(StockKind.SETS, StockKind.MANUAL_PARTS)))
        runCurrent()
        assertEquals("sent, it fetches the affected lists into the store", listOf(1, 1, 0, 0),
            listOf("getSets", "getParts", "getMinifigs", "getWantedList").map { fake.callsOf(it) })

        channel.acknowledge()
        situation.discarded.value = listOf(DiscardedChange("k1", "10001-1", "", 404))
        runCurrent()
        assertEquals("without a reason from the server a sentence of our own is shown",
            Message.Resource(R.string.offline_discarded, listOf("10001-1", Message.Resource(R.string.offline_discarded_without_reason))),
            channel.message.value)
    }

    @Test
    fun `a discarded item stays until its hint is cleared, then the next one comes`() = runTest {
        val situation = State()
        val channel = MessageChannel()
        val first = DiscardedChange("k1", "10001-1", "gibt es nicht", 404)
        val second = DiscardedChange("k2", "10002-1", "gibt es auch nicht", 404)
        situation.discarded.value = listOf(first, second)
        InitialObserver(situation, testStockReconciliation(FakeApi().api, TestStore()), channel).launch(backgroundScope)
        runCurrent()
        assertEquals(Message.Resource(R.string.offline_discarded, listOf("10001-1", "gibt es nicht")), channel.message.value)
        assertEquals("not seen yet: stays in the store", listOf(first, second), situation.discarded.value)
        channel.acknowledge()
        runCurrent()
        assertEquals(Message.Resource(R.string.offline_discarded, listOf("10002-1", "gibt es auch nicht")), channel.message.value)
        assertEquals(listOf(second), situation.discarded.value)
    }

    @Test
    fun `an item unreadable after the update is reported as such`() = runTest {
        val situation = State()
        val channel = MessageChannel()
        situation.discarded.value = listOf(DiscardedChange("k1", "10001-1", "", null, unreadable = true))
        InitialObserver(situation, testStockReconciliation(FakeApi().api, TestStore()), channel).launch(backgroundScope)
        runCurrent()
        assertEquals("an item unreadable after the update is reported as such",
            Message.Resource(R.string.offline_discarded, listOf("10001-1", Message.Resource(R.string.offline_discarded_unreadable))),
            channel.message.value)
    }

    @Test
    fun `a second start does not follow the outbox twice`() = runTest {
        val situation = State()
        val channel = MessageChannel()
        val notifier = InitialObserver(situation, testStockReconciliation(FakeApi().api, TestStore()), channel)
        notifier.launch(backgroundScope)
        notifier.launch(backgroundScope)
        runCurrent()
        assertEquals("a second start does not follow the outbox twice", 1, situation.scheduled)
        assertEquals(1, situation.number.subscriptionCount.value)
    }
}
