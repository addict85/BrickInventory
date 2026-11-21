package ch.brickinventoryapp.offline

import ch.brickinventoryapp.offline.Ausgang.DiscardedItem
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.update

/**
 * A waiting entry; [id] rises with every enqueue and is thus the order.
 * [schluessel] goes along as Idempotency-Key: if an attempt arrived, only the response
 * did not, the retry has no second effect at the server.
 */
data class Ausgangsposten(
    val id: Long,
    val bearbeitung: Editing,
    val erstellt: Long,
    val versuche: Int,
    val schluessel: String,
)

/**
 * Changes that were made but have not yet arrived at the server — per
 * area, in the order of enqueuing. On the device a Room table, so that
 * they survive a restart of the app.
 */
interface Ausgang {
    /**
     * An edit the server rejected; [ziel] names it for the hint („10001-1“).
     * [unlesbar]: the item could no longer be read after an update and never went out.
     */
    data class DiscardedItem(val id: String, val ziel: String, val meldung: String, val httpCode: Int?,
                                 val unlesbar: Boolean = false)

    fun anzahl(bereich: String): Flow<Int>
    suspend fun einreihen(bereich: String, bearbeitung: Editing, jetzt: Long, schluessel: String): Long
    /** Only readable items; reading changes nothing, unreadable ones are cleared only by [cleanUnreadable]. */
    suspend fun alle(bereich: String): List<Ausgangsposten>
    suspend fun erster(bereich: String): Ausgangsposten?

    /**
     * Report unreadable items as discarded and then remove them — never silently: they carry
     * changes that exist only on this device. Returns their number.
     */
    suspend fun cleanUnreadable(bereich: String): Int
    suspend fun entferne(id: Long)
    suspend fun attemptFailed(id: Long)
    suspend fun leere()

    /** Discarded items stay until their hint has been shown — even across a restart. */
    suspend fun rememberDiscarded(bereich: String, v: DiscardedItem)
    fun discarded(bereich: String): Flow<List<DiscardedItem>>
    suspend fun acknowledgeDiscarded(bereich: String, id: String)
}

/** In memory: for tests and as the default as long as no database is bound. */
class StorageExit : Ausgang {
    private val posten = MutableStateFlow<List<Pair<String, Ausgangsposten>>>(emptyList())
    private val nextId = java.util.concurrent.atomic.AtomicLong(1)
    private val verworfen = MutableStateFlow<List<Pair<String, DiscardedItem>>>(emptyList())

    override fun anzahl(bereich: String): Flow<Int> =
        posten.map { l -> l.count { it.first == bereich } }.distinctUntilChanged()

    override suspend fun einreihen(bereich: String, bearbeitung: Editing, jetzt: Long, schluessel: String): Long {
        val id = nextId.getAndIncrement()
        posten.update { it + (bereich to Ausgangsposten(id, bearbeitung, jetzt, 0, schluessel)) }
        return id
    }

    override suspend fun alle(bereich: String) = posten.value.filter { it.first == bereich }.map { it.second }

    override suspend fun erster(bereich: String) = alle(bereich).minByOrNull { it.id }

    /** Im Speicher liegt nichts in Textform, also nichts Unlesbares. */
    override suspend fun cleanUnreadable(bereich: String) = 0

    override suspend fun entferne(id: Long) = posten.update { l -> l.filterNot { it.second.id == id } }

    override suspend fun attemptFailed(id: Long) = posten.update { l ->
        l.map { if (it.second.id == id) it.first to it.second.copy(versuche = it.second.versuche + 1) else it }
    }

    override suspend fun leere() {
        posten.value = emptyList()
        verworfen.value = emptyList()
    }

    override suspend fun rememberDiscarded(bereich: String, v: DiscardedItem) =
        verworfen.update { l -> l.filterNot { it.first == bereich && it.second.id == v.id } + (bereich to v) }

    override fun discarded(bereich: String): Flow<List<DiscardedItem>> =
        verworfen.map { l -> l.filter { it.first == bereich }.map { it.second } }.distinctUntilChanged()

    override suspend fun acknowledgeDiscarded(bereich: String, id: String) =
        verworfen.update { l -> l.filterNot { it.first == bereich && it.second.id == id } }
}
