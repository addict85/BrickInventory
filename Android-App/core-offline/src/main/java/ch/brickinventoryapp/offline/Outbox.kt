package ch.brickinventoryapp.offline

import ch.brickinventoryapp.offline.Outbox.DiscardedItem
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.update

/**
 * A waiting entry; [id] rises with every enqueue and is thus the order.
 * [key] goes along as Idempotency-Key: if an attempt arrived, only the response
 * did not, the retry has no second effect at the server.
 */
data class OutboxItem(
    val id: Long,
    val editing: Editing,
    val created: Long,
    val attempts: Int,
    val key: String,
)

/**
 * Changes that were made but have not yet arrived at the server — per
 * area, in the order of enqueuing. On the device a Room table, so that
 * they survive a restart of the app.
 */
interface Outbox {
    /**
     * An edit the server rejected; [target] names it for the hint („10001-1“).
     * [unreadable]: the item could no longer be read after an update and never went out.
     */
    data class DiscardedItem(val id: String, val target: String, val message: String, val httpCode: Int?,
                                 val unreadable: Boolean = false)

    fun count(area: String): Flow<Int>
    suspend fun enqueue(area: String, editing: Editing, now: Long, key: String): Long
    /** Only readable items; reading changes nothing, unreadable ones are cleared only by [cleanUnreadable]. */
    suspend fun all(area: String): List<OutboxItem>
    suspend fun first(area: String): OutboxItem?

    /**
     * Report unreadable items as discarded and then remove them — never silently: they carry
     * changes that exist only on this device. Returns their number.
     */
    suspend fun cleanUnreadable(area: String): Int
    suspend fun remove(id: Long)
    suspend fun attemptFailed(id: Long)
    suspend fun empty()

    /** Discarded items stay until their hint has been shown — even across a restart. */
    suspend fun rememberDiscarded(area: String, v: DiscardedItem)
    fun discarded(area: String): Flow<List<DiscardedItem>>
    suspend fun acknowledgeDiscarded(area: String, id: String)
}

/** In memory: for tests and as the default as long as no database is bound. */
class OutboxStorage : Outbox {
    private val item = MutableStateFlow<List<Pair<String, OutboxItem>>>(emptyList())
    private val nextId = java.util.concurrent.atomic.AtomicLong(1)
    private val discarded = MutableStateFlow<List<Pair<String, DiscardedItem>>>(emptyList())

    override fun count(area: String): Flow<Int> =
        item.map { l -> l.count { it.first == area } }.distinctUntilChanged()

    override suspend fun enqueue(area: String, editing: Editing, now: Long, key: String): Long {
        val id = nextId.getAndIncrement()
        item.update { it + (area to OutboxItem(id, editing, now, 0, key)) }
        return id
    }

    override suspend fun all(area: String) = item.value.filter { it.first == area }.map { it.second }

    override suspend fun first(area: String) = all(area).minByOrNull { it.id }

    /** Im Speicher liegt nichts in Textform, also nichts Unlesbares. */
    override suspend fun cleanUnreadable(area: String) = 0

    override suspend fun remove(id: Long) = item.update { l -> l.filterNot { it.second.id == id } }

    override suspend fun attemptFailed(id: Long) = item.update { l ->
        l.map { if (it.second.id == id) it.first to it.second.copy(attempts = it.second.attempts + 1) else it }
    }

    override suspend fun empty() {
        item.value = emptyList()
        discarded.value = emptyList()
    }

    override suspend fun rememberDiscarded(area: String, v: DiscardedItem) =
        discarded.update { l -> l.filterNot { it.first == area && it.second.id == v.id } + (area to v) }

    override fun discarded(area: String): Flow<List<DiscardedItem>> =
        discarded.map { l -> l.filter { it.first == area }.map { it.second } }.distinctUntilChanged()

    override suspend fun acknowledgeDiscarded(area: String, id: String) =
        discarded.update { l -> l.filterNot { it.first == area && it.second.id == id } }
}
