package ch.brickinventoryapp.offline

import kotlinx.coroutines.flow.mapLatest
import ch.brickinventoryapp.model.json.BrickJson
import kotlinx.serialization.json.Json
import ch.brickinventoryapp.model.local.StockKind
import ch.brickinventoryapp.model.local.Local
import ch.brickinventoryapp.model.util.catchUnlessCancelled
import ch.brickinventoryapp.model.domain.EntryRequest
import ch.brickinventoryapp.model.domain.LocationEntryView
import ch.brickinventoryapp.model.domain.PriceAlertView
import ch.brickinventoryapp.model.domain.SetTotals
import ch.brickinventoryapp.model.domain.Condition
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.drop
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.flow
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.merge
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import ch.brickinventoryapp.offline.Outbox.DiscardedItem
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap

/**
 * A local list with type, key, its [StoreShape], the columns by which
 * it is filtered, and how an [OfflineStore.Effect] changes it — typed per
 * compartment, so that the store does not have to convert anything.
 */
class Domain<T : Any> internal constructor(
    val kind: StockKind,
    internal val form: StoreShape<T, *>,
    val key: (T) -> String,
    val apply: (List<T>, OfflineStore.Effect) -> List<T> = { l, _ -> l },
    val columns: (T) -> FilterColumns = { FilterColumns() },
)

object Slots {
    val SETS = Domain(StockKind.SETS, StoreShape(SetRow.serializer(), StoreRows::set, StoreRows::set),
        { it.setNumber }, LocalApplication::sets) {
        // Like the server: number, name, theme and year (without year „0“).
        FilterColumns(searchText(it.setNumber, it.name, it.theme.orEmpty(), (it.year ?: 0).toString()),
            theme = it.theme, storageLocation = it.storage)
    }
    val WANTED_LIST = Domain(StockKind.WANTED_LIST, StoreShape(RememberRow.serializer(), StoreRows::remember, StoreRows::remember),
        { LocalApplication.rememberKey(it) }, LocalApplication::wantedList) {
        FilterColumns(searchText(it.setNumber, it.name), condition = it.condition.identifier)
    }
    val PARTS = Domain(StockKind.PARTS, StoreShape(PartRow.serializer(), StoreRows::part, StoreRows::part),
        { "${it.partNumber}|${it.colorId}|${it.isSpare}" }, columns = {
        FilterColumns(searchText(it.partNumber, it.partName, it.blPartNumber), color = it.colorName,
            category = it.categoryName, sparePart = it.isSpare)
    })
    val FIGURES = Domain(StockKind.FIGURES, StoreShape(MinifigRow.serializer(), StoreRows::figure, StoreRows::figure),
        { it.figNumber }, columns = {
        FilterColumns(searchText(it.figNumber, it.figName))
    })
    val MANUAL_PARTS = Domain(StockKind.MANUAL_PARTS,
        StoreShape(ManualPartRow.serializer(), StoreRows::manualPart, StoreRows::manualPart),
        { "${it.partNumber}|${it.colorId}|${it.userId}" }, LocalApplication::manualParts) {
        FilterColumns(searchText(it.partNumber, it.partName, it.blPartNumber), storageLocation = it.storage)
    }
    val MANUAL_FIGURES = Domain(StockKind.MANUAL_FIGURES,
        StoreShape(ManualMinifigRow.serializer(), StoreRows::manualMinifig, StoreRows::manualMinifig),
        { "${it.figNumber}|${it.userId}" }, LocalApplication::manualMinifigs) {
        FilterColumns(searchText(it.figNumber, it.figName))
    }
    val VOUCHERS = Domain(StockKind.VOUCHERS, StoreShape(VoucherRow.serializer(), StoreRows::voucher, StoreRows::voucher),
        { it.id.toString() })

    /** At most one alert per set and condition, as at the server. */
    val PRICE_ALARMS = Domain(StockKind.PRICE_ALARMS, StoreShape(AlarmRow.serializer(), StoreRows::alarm, StoreRows::alarm),
        { "${it.setNumber}|${it.condition.identifier}" }, LocalApplication::priceAlarms) {
        FilterColumns(searchText(it.setNumber, it.name), condition = it.condition.identifier)
    }

    /** Der eigene Vorrat an Lagerorten samt Vorgabe. */
    val STORAGE_LOCATIONS = Domain(StockKind.STORAGE_LOCATIONS, StoreShape(StockRow.serializer(), StoreRows::stock, StoreRows::stock),
        { it.location.id.toString() }, LocalApplication::storageLocations) {
        FilterColumns(searchText(it.location.name))
    }

    /**
     * Single responses without a list: one row per area. Like the lists they lie in
     * Room, so that sign-out, area and encryption are the same for everything.
     */
    val METRICS = Domain(StockKind.METRICS,
        StoreShape(MetricsRow.serializer(), StoreRows::metrics, StoreRows::metrics), { SINGLE })
    val CATALOG_META = Domain(StockKind.CATALOG_META,
        StoreShape(CatalogMetaRow.serializer(), StoreRows::catalogMeta, StoreRows::catalogMeta), { SINGLE })

    private const val SINGLE = "einzeln"

    private fun searchText(vararg fields: String?) = fields.filterNotNull().joinToString("\n").lowercase()
}

/** Schedules sending the outbox; on the device via WorkManager (OutboxWorker). */
fun interface OutboxPlanner {
    fun plane()
}

/**
 * The local truth of the UI: lists and outbox per area (server and
 * account). The server stays authoritative — what it delivers replaces the list;
 * edits not yet sent are laid over it again afterwards, so that
 * they do not briefly disappear until the outbox is empty. It is built in
 * core-data, which knows the area of the signed-in account.
 */
class OfflineStore(
    private val stock: LocalInventory,
    /** A test passes a OutboxStorage in and looks there; the store does not show it. */
    private val outbox: Outbox,
    /** The area as it applies now: for writing and for the comparison before and after a fetch. */
    private val areaSource: suspend () -> String?,
    private val planner: OutboxPlanner = OutboxPlanner {},
    private val clock: () -> Long = System::currentTimeMillis,
    private val keySource: () -> String = { UUID.randomUUID().toString() },
    /**
     * The same area as a flow, for observing. On the device a StateFlow of the
     * session; without it every new observation asks the source once.
     */
    areaFlow: Flow<String?> = flow { emit(areaSource()) },
    /** Where a report about discarded items goes; on the device the log. */
    private val log: (String) -> Unit = {},
    private val json: Json = BrickJson,
) {
    /**
     * What a write changes in the local lists. Two kinds, so that the type
     * says what may go into the outbox: [Editing] waits without network and is
     * sent later; [FollowUp] exists only online and only updates the store.
     */
    sealed interface Effect {
        /** The lists that change. */
        val kinds: Set<StockKind>
    }

    /**
     * The result of a write that works only online, for the local list.
     * Without outbox: what the server calculates for it comes with the next sync.
     */
    sealed interface FollowUp : Effect {
        data class SetQuantitySet(val setNumber: String, val quantity: Int) : FollowUp {
            override val kinds get() = setOf(StockKind.SETS)
        }

        data class SetLocation(val setNumber: String, val location: String?) : FollowUp {
            override val kinds get() = setOf(StockKind.SETS)
        }

        data class SetRemoved(val setNumber: String) : FollowUp {
            override val kinds get() = setOf(StockKind.SETS)
        }

        /** [all]: all purchases move, the old owner disappears from the tile. */
        data class SetMoved(val setNumber: String, val of: Int?, val too: Int, val all: Boolean) : FollowUp {
            override val kinds get() = setOf(StockKind.SETS)
        }

        /** A changed purchase: the server sends along the new summary of the set. */
        data class SetSummary(val agg: SetTotals) : FollowUp {
            override val kinds get() = setOf(StockKind.SETS)
        }

        data class WantedItemMoved(val setNumber: String, val condition: Condition, val of: Int, val too: Int) : FollowUp {
            override val kinds get() = setOf(StockKind.WANTED_LIST)
        }

        /** The wishlist item goes into the collection: out of the wishlist, into the gallery. */
        data class WantedItemAdopted(val setNumber: String, val condition: Condition, val owner: Int?,
                                         val wish: EntryRequest) : FollowUp {
            override val kinds get() = setOf(StockKind.WANTED_LIST, StockKind.SETS)
        }

        data class PartLocation(val partNumber: String, val colorId: Int, val location: String?) : FollowUp {
            override val kinds get() = setOf(StockKind.MANUAL_PARTS)
        }

        /** The color is part of the key: if it hits an existing row, the server merges both. */
        data class PartColor(val partNumber: String, val colorId: Int, val newColor: Int, val colorName: String?,
                             val colorHex: String?, val owner: Int?) : FollowUp {
            override val kinds get() = setOf(StockKind.MANUAL_PARTS)
        }

        data class MinifigLocation(val figNumber: String, val location: String?) : FollowUp {
            override val kinds get() = setOf(StockKind.MANUAL_FIGURES)
        }

        /** A renamed place has the new name everywhere it stood, also in the supply. */
        data class LocationRenamed(val old: String, val newValue: LocationEntryView) : FollowUp {
            override val kinds get() = setOf(StockKind.SETS, StockKind.MANUAL_PARTS, StockKind.MANUAL_FIGURES,
                StockKind.STORAGE_LOCATIONS)
        }

        data class LocationCreated(val location: LocationEntryView) : FollowUp {
            override val kinds get() = setOf(StockKind.STORAGE_LOCATIONS)
        }

        data class LocationDeleted(val id: Int) : FollowUp {
            override val kinds get() = setOf(StockKind.STORAGE_LOCATIONS)
        }

        /** null: no default any more. */
        data class LocationDefault(val id: Int?) : FollowUp {
            override val kinds get() = setOf(StockKind.STORAGE_LOCATIONS)
        }

        /** The server sends back the saved alert; it replaces that of the set in the same condition. */
        data class AlarmSet(val alarm: PriceAlertView) : FollowUp {
            override val kinds get() = setOf(StockKind.PRICE_ALARMS)
        }

        data class AlarmRemoved(val setNumber: String, val condition: Condition) : FollowUp {
            override val kinds get() = setOf(StockKind.PRICE_ALARMS)
        }
    }

    private val current: Flow<String?> = areaFlow.map { valid(it) }.distinctUntilChanged()

    /**
     * One lock per area and list: reading, changing and writing a list
     * must not overtake each other, otherwise the later write overwrites the
     * earlier one (lost change).
     */
    private val lock = ConcurrentHashMap<Pair<String, StockKind>, Mutex>()

    private fun lock(b: String, kind: StockKind) = lock.getOrPut(b to kind) { Mutex() }

    /** The valid area, scattered; null = not signed in, then nothing is stored. */
    suspend fun area(): String? = valid(catchUnlessCancelled { areaSource() }.getOrNull())

    private fun valid(b: String?) = b?.takeIf { it.isNotBlank() }

    /** What the server rejected and has not been reported yet, for the current area. */
    @OptIn(ExperimentalCoroutinesApi::class)
    fun discarded(): Flow<List<DiscardedItem>> =
        current.flatMapLatest { b -> if (b == null) flowOf(emptyList()) else outbox.discarded(b) }

    /** The hint for [id] has been shown; the item may go. */
    suspend fun acknowledgeDiscarded(id: String) {
        val b = area() ?: return
        outbox.acknowledgeDiscarded(b, id)
    }

    /** How many edits are still waiting for the server. */
    @OptIn(ExperimentalCoroutinesApi::class)
    fun pending(): Flow<Int> = current.flatMapLatest { b -> if (b == null) flowOf(0) else outbox.count(b) }

    @OptIn(ExperimentalCoroutinesApi::class)
    fun <T : Any> observe(domain: Domain<T>): Flow<Local<T>> = current.flatMapLatest { b ->
        if (b == null) flowOf(Local(emptyList(), null))
        else stock.observe(b, domain.kind).map { decode(domain, it) }
    }

    /**
     * Every later change to one of the [slots] — for key figures the
     * server calculates over these lists. The store is the source: what it does not
     * change triggers nothing.
     */
    fun altered(vararg slots: Domain<*>): Flow<Unit> =
        merge(*slots.map { f -> observe(f).map { it.list }.distinctUntilChanged().drop(1).map { } }.toTypedArray())

    /**
     * The local list, only with the rows [filter] matches — asked anew on every change,
     * so that what was changed offline also appears in a filtered view.
     */
    @OptIn(ExperimentalCoroutinesApi::class)
    fun <T : Any> observe(domain: Domain<T>, filter: FilterColumns): Flow<Local<T>> =
        if (filter == FilterColumns()) observe(domain)
        else observe(domain).mapLatest { all -> if (all.state == null) all else filter(domain, filter) ?: all }

    suspend fun <T : Any> read(domain: Domain<T>): Local<T>? {
        val b = area() ?: return null
        return decode(domain, stock.read(b, domain.kind))
    }

    /** The local list, only with the rows [filter] matches; null if nobody is signed in. */
    suspend fun <T : Any> filter(domain: Domain<T>, filter: FilterColumns): Local<T>? {
        val b = area() ?: return null
        return decode(domain, stock.filter(b, domain.kind, filter))
    }

    /** Take over the server's whole list; whatever is still waiting lies over it again afterwards. */
    suspend fun <T : Any> adopt(domain: Domain<T>, list: List<T>, area: String? = null) {
        val b = area ?: area() ?: return
        stock.cleanOther(b)
        // Under the lock: a puffere() between reading the outbox and
        // writing would otherwise get lost with the server list.
        lock(b, domain.kind).withLock {
            val waiting = outbox.all(b).map { it.editing }.filter { it.kind == domain.kind }
            var together = list
            for (w in waiting) together = domain.apply(together, w)
            stock.replace(b, domain.kind, encode(domain, together), clock())
        }
    }

    /**
     * Is something still waiting for the current area (for [kind] or at all)?
     * Then new things must go behind it, otherwise the order tips over.
     */
    suspend fun waiting(kind: StockKind? = null): Boolean {
        val b = area() ?: return false
        return if (kind == null) outbox.first(b) != null else outbox.all(b).any { it.editing.kind == kind }
    }

    /**
     * A new Idempotency-Key. It is created before the first attempt, so that a
     * direct attempt and its retry from the outbox carry the same one.
     */
    fun newKey(): String = keySource()

    /**
     * Put an edit into the outbox and apply it locally. false if nobody
     * is signed in — then there is no place it belongs to.
     */
    suspend fun buffer(editing: Editing, key: String = newKey()): Boolean {
        val b = area() ?: return false
        // Enqueue and apply in one go: uebernimm() sees both or neither.
        lock(b, editing.kind).withLock {
            outbox.enqueue(b, editing, clock(), key)
            applyAnLocked(editing.kind, editing, b)
        }
        runCatching { planner.plane() }
        return true
    }

    /** Apply what succeeded online locally too, so that the list is right immediately. */
    suspend fun applyChange(effect: Effect, area: String? = null) {
        val b = area ?: area() ?: return
        // One list after another, never two locks at once: this way nothing can deadlock.
        for (kind in effect.kinds) lock(b, kind).withLock { applyAnLocked(kind, effect, b) }
    }

    private suspend fun applyAnLocked(kind: StockKind, w: Effect, b: String) = when (kind) {
        StockKind.SETS -> applyChangeTo(Slots.SETS, b, w)
        StockKind.WANTED_LIST -> applyChangeTo(Slots.WANTED_LIST, b, w)
        StockKind.MANUAL_PARTS -> applyChangeTo(Slots.MANUAL_PARTS, b, w)
        StockKind.MANUAL_FIGURES -> applyChangeTo(Slots.MANUAL_FIGURES, b, w)
        StockKind.PRICE_ALARMS -> applyChangeTo(Slots.PRICE_ALARMS, b, w)
        StockKind.STORAGE_LOCATIONS -> applyChangeTo(Slots.STORAGE_LOCATIONS, b, w)
        // Only delivered by the server, never edited locally.
        StockKind.PARTS, StockKind.FIGURES, StockKind.VOUCHERS, StockKind.METRICS,
        StockKind.CATALOG_META -> Unit
    }

    /** Trigger sending, e.g. at start, in case something is still waiting from last time. */
    fun sendPlane() = runCatching { planner.plane() }

    /** On sign-out: lists and outbox of all areas. */
    suspend fun empty() {
        stock.empty()
        outbox.empty()
    }

    /** Call only under the lock of ([b], fach.art). */
    private suspend fun <T : Any> applyChangeTo(domain: Domain<T>, b: String, w: Effect) {
        val old = decode(domain, stock.read(b, domain.kind))
        stock.syncRows(b, domain.kind, encode(domain, domain.apply(old.list, w)))
    }

    private fun <T : Any> encode(domain: Domain<T>, list: List<T>) =
        list.map { LocalRow(domain.key(it), domain.form.encode(json, it), domain.columns(it)) }

    /**
     * Rows that can no longer be read are dropped instead of blocking the list —
     * but not silently: their number stands in [Local.discarded] and goes into the [log].
     */
    private fun <T : Any> decode(domain: Domain<T>, l: Local<LocalRow>): Local<T> {
        val read = l.list.mapNotNull { z -> runCatching { domain.form.decode(json, z.content) }.getOrNull() }
        val discarded = l.list.size - read.size
        if (discarded > 0) log("Ablage ${domain.kind}: $discarded von ${l.list.size} Zeilen unlesbar, verworfen")
        return Local(read, l.state, discarded)
    }
}
