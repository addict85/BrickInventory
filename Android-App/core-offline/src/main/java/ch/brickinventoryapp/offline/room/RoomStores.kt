package ch.brickinventoryapp.offline.room

import ch.brickinventoryapp.model.json.BrickJson
import ch.brickinventoryapp.model.local.Local
import ch.brickinventoryapp.model.local.StockKind
import ch.brickinventoryapp.offline.Editing
import ch.brickinventoryapp.offline.FilterColumns
import ch.brickinventoryapp.offline.InitialForm
import ch.brickinventoryapp.offline.LocalInventory
import ch.brickinventoryapp.offline.LocalRow
import ch.brickinventoryapp.offline.Outbox
import ch.brickinventoryapp.offline.Outbox.DiscardedItem
import ch.brickinventoryapp.offline.OutboxItem
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.map
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import javax.inject.Inject

/** [LocalInventory] via Room: rows and state per area and kind. */
internal class RoomInventory @Inject constructor(private val db: InventoryDatabase) : LocalInventory {
    private val dao get() = db.stock()

    override fun observe(area: String, kind: StockKind): Flow<Local<LocalRow>> =
        combine(dao.observe(area, kind.name), dao.observeStatus(area, kind.name)) { rows, state ->
            Local(rows.map(::asLocal), state)
        }

    override suspend fun read(area: String, kind: StockKind) =
        Local(dao.read(area, kind.name).map(::asLocal), dao.state(area, kind.name))

    override suspend fun filter(area: String, kind: StockKind, filter: FilterColumns): Local<LocalRow> {
        val f = filter
        val rows = dao.filter(area, kind.name, f.searchText?.let(::containsPattern), f.theme, f.storageLocation, f.color,
            f.category, f.sparePart, f.condition)
        return Local(rows.map(::asLocal), dao.state(area, kind.name))
    }

    override suspend fun replace(area: String, kind: StockKind, rows: List<LocalRow>, state: Long?) =
        dao.replace(area, kind.name,
            // Duplicate keys would violate the primary key; the later row applies.
            rows.associateBy { it.key }.values.mapIndexed { i, z -> asRow(z, area, kind, i) },
            state)

    override suspend fun syncRows(area: String, kind: StockKind, rows: List<LocalRow>) =
        dao.syncRows(area, kind.name, rows.associateBy { it.key }.values.mapIndexed { i, z -> asRow(z, area, kind, i) })

    override suspend fun cleanOther(area: String) {
        dao.deleteOtherRows(area)
        dao.deleteOtherStates(area)
    }

    override suspend fun empty() {
        dao.emptyRows()
        dao.emptyStates()
    }
}

private fun asLocal(z: InventoryRow) = with(z) {
    LocalRow(key, content, FilterColumns(searchText, theme, storageLocation, color, category, sparePart, condition))
}

private fun asRow(z: LocalRow, area: String, kind: StockKind, position: Int) = with(z.columns) {
    InventoryRow(area, kind.name, z.key, position, z.content, searchText.orEmpty(), theme, storageLocation, color, category,
        sparePart, condition)
}

/** „Contains“ as LIKE pattern; `%`, `_` and `\` apply literally as at the server (`likeSearch.ts`). */
internal fun containsPattern(search: String): String =
    "%" + search.lowercase().replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_") + "%"

/**
 * [Outbox] via Room; every item lies in the [InitialForm]. Reading never writes:
 * an unreadable item stays until [cleanUnreadable] reports it as discarded.
 */
internal class RoomOutbox @Inject constructor(
    private val db: InventoryDatabase,
    private val json: Json = BrickJson,
) : Outbox {
    private val dao get() = db.outbox()

    override fun count(area: String) = dao.count(area)

    override suspend fun enqueue(area: String, editing: Editing, now: Long, key: String) =
        dao.addOne(OutboxRow(area = area, editing = InitialForm.encode(json, editing),
            created = now, key = key))

    override suspend fun all(area: String) = dao.all(area).mapNotNull { read(it) }

    override suspend fun first(area: String): OutboxItem? = dao.all(area).firstNotNullOfOrNull { read(it) }

    override suspend fun cleanUnreadable(area: String): Int {
        val unreadable = dao.all(area).filter { read(it) == null }
        for (z in unreadable) {
            // First record the hint, then remove: if the process dies in between, the hint stays.
            val target = InitialForm.targetFrom(json, z.editing) ?: "?"
            rememberDiscarded(area, DiscardedItem(z.key.ifBlank { "posten-${z.id}" }, target, "", null, unreadable = true))
            dao.remove(z.id)
        }
        return unreadable.size
    }

    override suspend fun remove(id: Long) = dao.remove(id)
    override suspend fun attemptFailed(id: Long) = dao.attemptFailed(id)
    override suspend fun empty() = dao.empty()

    // Discarded items lie as their own kind in the table `stock`: permanent without a new schema,
    // and sign-out (clearing the stock) clears them too.
    private val stock get() = db.stock()

    override suspend fun rememberDiscarded(area: String, v: DiscardedItem) {
        val position = stock.read(area, DISCARDED).maxOfOrNull { it.position }?.plus(1) ?: 0
        val content = json.encodeToString(DiscardedRow.serializer(), DiscardedRow(v.target, v.message, v.httpCode, v.unreadable))
        stock.deleteKeys(area, DISCARDED, listOf(v.id))
        stock.addOne(listOf(InventoryRow(area, DISCARDED, v.id, position, content)))
    }

    override fun discarded(area: String): Flow<List<DiscardedItem>> =
        stock.observe(area, DISCARDED).map { rows ->
            rows.mapNotNull { z ->
                runCatching { json.decodeFromString(DiscardedRow.serializer(), z.content) }.getOrNull()
                    ?.let { DiscardedItem(z.key, it.target, it.message, it.httpCode, it.unreadable) }
            }
        }

    override suspend fun acknowledgeDiscarded(area: String, id: String) = stock.deleteKeys(area, DISCARDED, listOf(id))

    private fun read(z: OutboxRow): OutboxItem? =
        runCatching { InitialForm.decode(json, z.editing) }.getOrNull()
            ?.let { OutboxItem(z.id, it, z.created, z.attempts, z.key) }
}

/** The kind under which discarded items lie in `stock`; no [StockKind] has this name. */
internal const val DISCARDED = "AUSGANG_VERWORFEN"

@Serializable
internal data class DiscardedRow(@SerialName("ziel") val target: String, @SerialName("meldung") val message: String, val httpCode: Int? = null, @SerialName("unlesbar") val unreadable: Boolean = false)
