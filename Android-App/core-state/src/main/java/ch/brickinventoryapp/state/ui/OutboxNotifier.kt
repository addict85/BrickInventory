package ch.brickinventoryapp.state.ui

import ch.brickinventoryapp.data.local.Baseline
import ch.brickinventoryapp.data.local.Baseline.DiscardedChange
import ch.brickinventoryapp.data.local.ReconcileEvent
import ch.brickinventoryapp.dataapi.message.MessageChannel
import ch.brickinventoryapp.dataapi.stock.StockReconciliation
import ch.brickinventoryapp.model.local.StockKind
import ch.brickinventoryapp.model.text.Message
import ch.brickinventoryapp.resources.R
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import java.util.concurrent.atomic.AtomicBoolean
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Makes the outbox visible: the number of open changes for the bar, a
 * hint as soon as something was stored offline or the server rejected it,
 * and the server state of the affected lists into the store once something was sent —
 * the local assumption is thereby replaced.
 */
interface OutboxNotifier {
    /** The number of open changes; 0 until [launch] has run. */
    val pending: StateFlow<Int>

    /** Once per process (the Application); a second call does nothing. */
    fun launch(scope: CoroutineScope)
}

@Singleton
class InitialObserver @Inject constructor(
    private val situation: Baseline,
    private val sync: StockReconciliation,
    private val messages: MessageChannel,
) : OutboxNotifier {
    private val _open = MutableStateFlow(0)
    override val pending: StateFlow<Int> = _open.asStateFlow()
    private val started = AtomicBoolean(false)

    override fun launch(scope: CoroutineScope) {
        if (!started.compareAndSet(false, true)) return
        scope.launch {
            var before = 0
            situation.pending().collect { n ->
                _open.value = n
                if (n > before) messages.show(Message.Quantity(R.plurals.offline_outbox, n))
                before = n
            }
        }
        scope.launch { situation.events.collect { report(it) } }
        scope.launch { situation.discarded().collect { l -> l.firstOrNull()?.let { reportDiscarded(it) } } }
        // Whatever is still waiting from last time goes out at startup.
        scope.launch { situation.planeLeftover() }
    }

    private suspend fun report(e: ReconcileEvent) {
        when (e) {
            is ReconcileEvent.Sent -> e.kinds.mapNotNull { listFor(it) }.toSet().forEach { reconcileList(it) }
        }
    }

    /** Only acknowledges once the hint has had its turn and been cleared away; until then the store holds it. */
    private suspend fun reportDiscarded(v: DiscardedChange) {
        val reason = if (v.unreadable) Message.Resource(R.string.offline_discarded_unreadable)
            else v.message.ifBlank { null } ?: Message.Resource(R.string.offline_discarded_without_reason)
        val hint = Message.Resource(R.string.offline_discarded, listOf(v.target, reason))
        messages.show(hint)
        messages.message.first { it == hint }
        messages.message.first { it != hint }
        situation.acknowledge(v)
    }

    /** Parts and manual parts come with one fetch; so do the figures. */
    private enum class ListKind { SETS, WANTED_LIST, PARTS, FIGURES }

    private fun listFor(kind: StockKind): ListKind? = when (kind) {
        StockKind.SETS -> ListKind.SETS
        StockKind.WANTED_LIST -> ListKind.WANTED_LIST
        StockKind.PARTS, StockKind.MANUAL_PARTS -> ListKind.PARTS
        StockKind.FIGURES, StockKind.MANUAL_FIGURES -> ListKind.FIGURES
        // Never change via the outbox, only online.
        StockKind.VOUCHERS, StockKind.PRICE_ALARMS, StockKind.STORAGE_LOCATIONS,
        StockKind.METRICS, StockKind.CATALOG_META -> null
    }

    private suspend fun reconcileList(l: ListKind) {
        when (l) {
            ListKind.SETS -> sync.sets()
            ListKind.WANTED_LIST -> sync.wantedList()
            ListKind.PARTS -> sync.parts()
            ListKind.FIGURES -> sync.figures()
        }
    }
}

/** Redraw the home-screen widget; the app sets it (AppModule), core-state doesn't know it. */
fun interface WidgetKick {
    suspend fun refresh()
}
