package ch.brickinventoryapp.data.local

import ch.brickinventoryapp.contract.UpdateQuantityRequest
import ch.brickinventoryapp.data.api.MinifigsApi
import ch.brickinventoryapp.data.api.PartsApi
import ch.brickinventoryapp.data.api.SetsApi
import ch.brickinventoryapp.data.local.Baseline.DiscardedChange
import ch.brickinventoryapp.data.repository.Outcome
import ch.brickinventoryapp.data.repository.safeCall
import ch.brickinventoryapp.model.local.StockKind
import ch.brickinventoryapp.offline.Editing
import ch.brickinventoryapp.offline.OfflineStore
import ch.brickinventoryapp.offline.Outbox
import ch.brickinventoryapp.offline.Outbox.DiscardedItem
import ch.brickinventoryapp.offline.OutboxItem
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import javax.inject.Inject
import javax.inject.Singleton

/** What the server said about an edit. */
sealed class SendOutcome {
    data object Accepted : SendOutcome()
    /** The server refuses (4xx): retrying changes nothing, the edit is discarded. */
    data class Rejected(val message: String, val httpCode: Int?) : SendOutcome()
    /** Unreachable, timeout, 5xx, session expired: once more later. */
    data object Later : SendOutcome()
}

fun interface EditingSender {
    /** [key] goes along as Idempotency-Key; it is the same on every retry. */
    suspend fun send(b: Editing, key: String): SendOutcome
}

/**
 * Classifies a response. 401, 408 and 429 are 4xx but no verdict on the
 * edit — after signing in again or some waiting it succeeds. A 2xx
 * without a body has arrived.
 */
fun classify(r: Outcome<*>): SendOutcome = when (r) {
    is Outcome.Success -> SendOutcome.Accepted
    is Outcome.Failure -> classifyError(r)
}

/** When deleting, „does not exist (any more)“ is the goal: a 404 has arrived, not been refused. */
fun deleteClassify(r: Outcome<*>): SendOutcome =
    if (r is Outcome.Failure.Server && r.status == 404) SendOutcome.Accepted else classify(r)

// Without an HTTP status the server has not judged (network, break, exception): once more later.
private fun classifyError(r: Outcome.Failure): SendOutcome = when (r) {
    is Outcome.Failure.EmptyResponse -> SendOutcome.Accepted
    is Outcome.Failure.Server ->
        if (r.status in 400..499 && r.status !in setOf(401, 408, 429)) SendOutcome.Rejected(r.message, r.status)
        else SendOutcome.Later
    is Outcome.Failure.Refusal -> SendOutcome.Rejected(r.message, null)
    is Outcome.Failure.Rejected, is Outcome.Failure.Network, Outcome.Failure.Timeout,
    Outcome.Failure.Cancelled, Outcome.Failure.Plaintext, is Outcome.Failure.Unknown -> SendOutcome.Later
}

enum class ReconcileOutcome {
    DONE, LATER, NOT_SIGNED_IN;

    /**
     * Should the worker try again later? Not without sign-in, unless
     * the device is locked: then the token has merely not been read yet (readToken).
     */
    fun again(deviceLocked: Boolean): Boolean = when (this) {
        LATER -> true
        DONE -> false
        NOT_SIGNED_IN -> deviceLocked
    }
}

/**
 * Sends the outbox in order. An item leaves the outbox only when
 * the server has accepted or refused it; on „later“ it stays in front and
 * everything behind it waits, so that the order holds. The lock prevents
 * a second run (worker and app at once) from sending the same item once more.
 */
@Singleton
class Reconcile @Inject constructor(
    private val store: OfflineStore,
    private val outbox: Outbox,
    private val sender: EditingSender,
) : Baseline {
    private val lock = Mutex()
    private val _events = MutableSharedFlow<ReconcileEvent>(extraBufferCapacity = 16)
    override val events: SharedFlow<ReconcileEvent> = _events.asSharedFlow()

    override fun pending(): Flow<Int> = store.pending()

    override fun discarded(): Flow<List<DiscardedChange>> = store.discarded().map { l ->
        l.map { DiscardedChange(it.id, it.target, it.message, it.httpCode, it.unreadable) }
    }

    override suspend fun acknowledge(v: DiscardedChange) = store.acknowledgeDiscarded(v.id)

    override suspend fun planeLeftover() {
        if (store.waiting()) store.sendPlane()
    }

    suspend fun send(): ReconcileOutcome = lock.withLock {
        val area = store.area() ?: return@withLock ReconcileOutcome.NOT_SIGNED_IN
        val affected = mutableSetOf<StockKind>()
        // Before sending: what can no longer be read is reported instead of skipped.
        outbox.cleanUnreadable(area)
        try {
            jobRun(area, affected)
        } finally {
            if (affected.isNotEmpty()) _events.tryEmit(ReconcileEvent.Sent(affected))
        }
    }

    private suspend fun jobRun(area: String, affected: MutableSet<StockKind>): ReconcileOutcome {
        var p = outbox.first(area)
        while (p != null) {
            // Immediately before every send: the guard attaches the token that applies
            // NOW. After an account switch the item would otherwise go out under a foreign account.
            if (store.area() != area) return ReconcileOutcome.NOT_SIGNED_IN
            when (val e = sender.send(p.editing, p.key)) {
                SendOutcome.Accepted -> {
                    outbox.remove(p.id)
                    affected += p.editing.kind
                }
                is SendOutcome.Rejected -> discard(area, p, e.message, e.httpCode, affected)
                SendOutcome.Later -> {
                    if (p.attempts + 1 < MAX_ATTEMPTS) {
                        outbox.attemptFailed(p.id)
                        return ReconcileOutcome.LATER
                    }
                    discard(area, p, "", null, affected)
                }
            }
            p = outbox.first(area)
        }
        return ReconcileOutcome.DONE
    }

    private suspend fun discard(area: String, p: OutboxItem, message: String, code: Int?, affected: MutableSet<StockKind>) {
        // First record, then remove: if the process dies in between, the hint stays.
        outbox.rememberDiscarded(area, DiscardedItem(p.key.ifBlank { "posten-${p.id}" }, p.editing.target, message, code))
        outbox.remove(p.id)
        // The local list still carries the edit; reloading restores the server state.
        affected += p.editing.kind
    }

    companion object {
        /** With WorkManager's backoff about two days — then it is no longer a dead spot. */
        const val MAX_ATTEMPTS = 20
    }
}

/** Sends an edit with the request that would have gone online (the same mapping), including its key. */
class ServerSender @Inject constructor(
    private val sets: SetsApi,
    private val parts: PartsApi,
    private val figures: MinifigsApi,
) : EditingSender {
    override suspend fun send(b: Editing, key: String): SendOutcome = when (b) {
        is Editing.SetQuantity -> classify(safeCall {
            sets.updateSetQuantity(b.setNumber, UpdateQuantityRequest(quantityDelta = b.step), key)
        })
        is Editing.RecordSet -> classify(safeCall { sets.addSet(b.wish.asRequest(), key) })
        is Editing.CreateWantedItem -> classify(safeCall { sets.createWantedItem(b.wish.asRequest(), key) })
        is Editing.DeleteWantedItem -> deleteClassify(safeCall {
            sets.deleteWantedItem(b.setNumber, b.condition.identifier, b.owner, key)
        })
        is Editing.RecordPart -> classify(safeCall { parts.addPart(b.entry.asRequest(), key) })
        is Editing.EditPart -> classify(safeCall {
            parts.updatePart(b.partNumber, b.colorId, b.change.asRequest(), b.owner, key)
        })
        is Editing.DeletePart -> deleteClassify(safeCall {
            parts.deletePart(b.partNumber, b.colorId, b.owner, key)
        })
        is Editing.RecordFigure -> classify(safeCall { figures.addMinifig(b.entry.asRequest(), key) })
        is Editing.EditFigure -> classify(safeCall {
            figures.updateMinifig(b.figNumber, b.change.asRequest(), b.owner, key)
        })
        is Editing.DeleteFigure -> deleteClassify(safeCall {
            figures.deleteMinifig(b.figNumber, b.owner, key)
        })
    }
}
