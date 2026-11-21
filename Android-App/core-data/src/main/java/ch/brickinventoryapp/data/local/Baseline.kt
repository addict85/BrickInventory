package ch.brickinventoryapp.data.local

import ch.brickinventoryapp.model.local.StockKind
import kotlinx.coroutines.flow.Flow

/** What happened during the sync — the UI reloads the affected lists. */
sealed class Abgleichsereignis {
    data class Sent(val kinds: Set<StockKind>) : Abgleichsereignis()
}

/**
 * What the UI sees of the outbox: the number of open changes and what happened
 * during sending. core-state thus knows neither store nor edits.
 */
interface Baseline {
    /**
     * An edit the server refused. Not a transient event: it lies in the
     * store until its hint has been shown. [ziel] names it for the hint („10001-1“);
     * [unlesbar]: no longer readable after an update, never sent.
     */
    data class DiscardedChange(val id: String, val ziel: String, val meldung: String, val httpCode: Int?,
                                   val unlesbar: Boolean = false)

    fun offene(): Flow<Int>
    val events: Flow<Abgleichsereignis>
    /** Refused items whose hint is still pending; the oldest first. */
    fun discarded(): Flow<List<DiscardedChange>>
    /** The hint for [v] has been shown. */
    suspend fun acknowledge(v: DiscardedChange)
    /** Schedule for sending what is still waiting from last time. */
    suspend fun planeLeftover()
}
