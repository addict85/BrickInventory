package ch.brickinventoryapp.offline

import ch.brickinventoryapp.model.local.Local
import ch.brickinventoryapp.model.local.StockKind
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.update

/**
 * The columns the server filters by — on a row their values, in a
 * query the pattern: what is set must be equal, [searchText] contained
 * (case-insensitive). On the row [searchText] carries the searched fields,
 * separated by line breaks, so that no hit reaches across a field boundary.
 */
data class FilterColumns(
    val searchText: String? = null,
    val theme: String? = null,
    val storageLocation: String? = null,
    val color: String? = null,
    val category: String? = null,
    val sparePart: Boolean? = null,
    val condition: String? = null,
) {
    /** Like the query in Room, for the in-memory store. */
    fun hits(row: FilterColumns): Boolean =
        (searchText == null || row.searchText.orEmpty().contains(searchText.lowercase())) &&
            (theme == null || row.theme == theme) && (storageLocation == null || row.storageLocation == storageLocation) &&
            (color == null || row.color == color) && (category == null || row.category == category) &&
            (sparePart == null || row.sparePart == sparePart) && (condition == null || row.condition == condition)
}

/** A row: key, the model as the server delivered it (JSON), and its filter columns. */
data class LocalRow(val key: String, val content: String, val columns: FilterColumns = FilterColumns())

/**
 * The local store of the stock, separated per area (server and account). On the
 * device Room ([ch.brickinventoryapp.offline.room.RoomInventory]); the
 * interface keeps the sync logic testable without Android. A list comes
 * as [Local] with the point in time at which the server last delivered it.
 */
interface LocalInventory {
    fun observe(area: String, kind: StockKind): Flow<Local<LocalRow>>
    suspend fun read(area: String, kind: StockKind): Local<LocalRow>
    /** Only the rows that [filter] matches, in the order of the list. */
    suspend fun filter(area: String, kind: StockKind, filter: FilterColumns): Local<LocalRow>
    /** Replaces the list; [state] null means „changed locally, server state stays“. */
    suspend fun replace(area: String, kind: StockKind, rows: List<LocalRow>, state: Long?)
    /** Like [replace] without state, but writes only new, changed and deleted rows. */
    suspend fun syncRows(area: String, kind: StockKind, rows: List<LocalRow>)
    /** Delete everything that does not belong to [area] — on the device only one account is ever signed in. */
    suspend fun cleanOther(area: String)
    suspend fun empty()
}

/** In memory: for tests and as the default as long as no database is bound. */
class StorageInventory : LocalInventory {
    private val data = MutableStateFlow<Map<Pair<String, StockKind>, Local<LocalRow>>>(emptyMap())

    override fun observe(area: String, kind: StockKind): Flow<Local<LocalRow>> =
        data.map { it[area to kind] ?: Local(emptyList(), null) }.distinctUntilChanged()

    override suspend fun read(area: String, kind: StockKind) =
        data.value[area to kind] ?: Local(emptyList(), null)

    override suspend fun filter(area: String, kind: StockKind, filter: FilterColumns) =
        read(area, kind).let { l -> l.copy(list = l.list.filter { filter.hits(it.columns) }) }

    override suspend fun replace(area: String, kind: StockKind, rows: List<LocalRow>, state: Long?) =
        data.update { old ->
            old + ((area to kind) to Local(rows.associateBy { it.key }.values.toList(),
                state ?: old[area to kind]?.state))
        }

    override suspend fun syncRows(area: String, kind: StockKind, rows: List<LocalRow>) =
        replace(area, kind, rows, null)

    override suspend fun cleanOther(area: String) = data.update { old -> old.filterKeys { it.first == area } }

    override suspend fun empty() { data.value = emptyMap() }
}
