package ch.brickinventoryapp.offline

import kotlinx.coroutines.flow.mapLatest
import ch.brickinventoryapp.model.json.BrickJson
import kotlinx.serialization.json.Json
import ch.brickinventoryapp.model.local.StockKind
import ch.brickinventoryapp.model.local.Local
import ch.brickinventoryapp.model.util.fangeAusserAbbruch
import ch.brickinventoryapp.model.domain.Erfassungswunsch
import ch.brickinventoryapp.model.domain.LocationEntryView
import ch.brickinventoryapp.model.domain.PriceAlertView
import ch.brickinventoryapp.model.domain.Setzusammenfassung
import ch.brickinventoryapp.model.domain.Zustand
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
import ch.brickinventoryapp.offline.Ausgang.DiscardedItem
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap

/**
 * A local list with type, key, its [Ablageform], the columns by which
 * it is filtered, and how an [Offlineablage.Wirkung] changes it — typed per
 * compartment, so that the store does not have to convert anything.
 */
class Fach<T : Any> internal constructor(
    val art: StockKind,
    internal val form: Ablageform<T, *>,
    val schluessel: (T) -> String,
    val anwenden: (List<T>, Offlineablage.Wirkung) -> List<T> = { l, _ -> l },
    val spalten: (T) -> Filterspalten = { Filterspalten() },
)

object Slots {
    val SETS = Fach(StockKind.SETS, Ablageform(SetRow.serializer(), Ablagezeilen::set, Ablagezeilen::set),
        { it.setNumber }, LocalApplication::sets) {
        // Like the server: number, name, theme and year (without year „0“).
        Filterspalten(suchtext(it.setNumber, it.name, it.theme.orEmpty(), (it.year ?: 0).toString()),
            thema = it.theme, lagerort = it.storage)
    }
    val MERKLISTE = Fach(StockKind.MERKLISTE, Ablageform(RememberRow.serializer(), Ablagezeilen::remember, Ablagezeilen::remember),
        { LocalApplication.rememberKey(it) }, LocalApplication::merkliste) {
        Filterspalten(suchtext(it.setNumber, it.name), zustand = it.condition.kennung)
    }
    val TEILE = Fach(StockKind.TEILE, Ablageform(PartRow.serializer(), Ablagezeilen::teil, Ablagezeilen::teil),
        { "${it.partNumber}|${it.colorId}|${it.isSpare}" }, spalten = {
        Filterspalten(suchtext(it.partNumber, it.partName, it.blPartNumber), farbe = it.colorName,
            kategorie = it.categoryName, ersatzteil = it.isSpare)
    })
    val FIGUREN = Fach(StockKind.FIGUREN, Ablageform(MinifigRow.serializer(), Ablagezeilen::figur, Ablagezeilen::figur),
        { it.figNumber }, spalten = {
        Filterspalten(suchtext(it.figNumber, it.figName))
    })
    val MANUELLE_TEILE = Fach(StockKind.MANUELLE_TEILE,
        Ablageform(ManualPartRow.serializer(), Ablagezeilen::manualPart, Ablagezeilen::manualPart),
        { "${it.partNumber}|${it.colorId}|${it.userId}" }, LocalApplication::manuelleTeile) {
        Filterspalten(suchtext(it.partNumber, it.partName, it.blPartNumber), lagerort = it.storage)
    }
    val MANUELLE_FIGUREN = Fach(StockKind.MANUELLE_FIGUREN,
        Ablageform(ManualMinifigRow.serializer(), Ablagezeilen::manualMinifig, Ablagezeilen::manualMinifig),
        { "${it.figNumber}|${it.userId}" }, LocalApplication::manualMinifigs) {
        Filterspalten(suchtext(it.figNumber, it.figName))
    }
    val GUTSCHEINE = Fach(StockKind.GUTSCHEINE, Ablageform(VoucherRow.serializer(), Ablagezeilen::gutschein, Ablagezeilen::gutschein),
        { it.id.toString() })

    /** At most one alert per set and condition, as at the server. */
    val PREISALARME = Fach(StockKind.PREISALARME, Ablageform(AlarmRow.serializer(), Ablagezeilen::alarm, Ablagezeilen::alarm),
        { "${it.setNumber}|${it.condition.kennung}" }, LocalApplication::preisalarme) {
        Filterspalten(suchtext(it.setNumber, it.name), zustand = it.condition.kennung)
    }

    /** Der eigene Vorrat an Lagerorten samt Vorgabe. */
    val LAGERORTE = Fach(StockKind.LAGERORTE, Ablageform(StockRow.serializer(), Ablagezeilen::stock, Ablagezeilen::stock),
        { it.ort.id.toString() }, LocalApplication::lagerorte) {
        Filterspalten(suchtext(it.ort.name))
    }

    /**
     * Single responses without a list: one row per area. Like the lists they lie in
     * Room, so that sign-out, area and encryption are the same for everything.
     */
    val KENNZAHLEN = Fach(StockKind.KENNZAHLEN,
        Ablageform(MetricsRow.serializer(), Ablagezeilen::metrics, Ablagezeilen::metrics), { SINGLE })
    val KATALOG_META = Fach(StockKind.KATALOG_META,
        Ablageform(CatalogMetaRow.serializer(), Ablagezeilen::catalogMeta, Ablagezeilen::catalogMeta), { SINGLE })

    private const val SINGLE = "einzeln"

    private fun suchtext(vararg felder: String?) = felder.filterNotNull().joinToString("\n").lowercase()
}

/** Schedules sending the outbox; on the device via WorkManager (ExitWorker). */
fun interface ExitPlanner {
    fun plane()
}

/**
 * The local truth of the UI: lists and outbox per area (server and
 * account). The server stays authoritative — what it delivers replaces the list;
 * edits not yet sent are laid over it again afterwards, so that
 * they do not briefly disappear until the outbox is empty. It is built in
 * core-data, which knows the area of the signed-in account.
 */
class Offlineablage(
    private val bestand: LocalInventory,
    /** A test passes a StorageExit in and looks there; the store does not show it. */
    private val ausgang: Ausgang,
    /** The area as it applies now: for writing and for the comparison before and after a fetch. */
    private val areaSource: suspend () -> String?,
    private val planner: ExitPlanner = ExitPlanner {},
    private val clock: () -> Long = System::currentTimeMillis,
    private val keySource: () -> String = { UUID.randomUUID().toString() },
    /**
     * The same area as a flow, for observing. On the device a StateFlow of the
     * session; without it every new observation asks the source once.
     */
    areaFlow: Flow<String?> = flow { emit(areaSource()) },
    /** Where a report about discarded items goes; on the device the log. */
    private val protokoll: (String) -> Unit = {},
    private val json: Json = BrickJson,
) {
    /**
     * What a write changes in the local lists. Two kinds, so that the type
     * says what may go into the outbox: [Editing] waits without network and is
     * sent later; [FollowUp] exists only online and only updates the store.
     */
    sealed interface Wirkung {
        /** The lists that change. */
        val kinds: Set<StockKind>
    }

    /**
     * The result of a write that works only online, for the local list.
     * Without outbox: what the server calculates for it comes with the next sync.
     */
    sealed interface FollowUp : Wirkung {
        data class SetQuantitySet(val setNumber: String, val menge: Int) : FollowUp {
            override val kinds get() = setOf(StockKind.SETS)
        }

        data class SetLocation(val setNumber: String, val ort: String?) : FollowUp {
            override val kinds get() = setOf(StockKind.SETS)
        }

        data class SetRemoved(val setNumber: String) : FollowUp {
            override val kinds get() = setOf(StockKind.SETS)
        }

        /** [alle]: all purchases move, the old owner disappears from the tile. */
        data class SetMoved(val setNumber: String, val von: Int?, val zu: Int, val alle: Boolean) : FollowUp {
            override val kinds get() = setOf(StockKind.SETS)
        }

        /** A changed purchase: the server sends along the new summary of the set. */
        data class SetSummary(val agg: Setzusammenfassung) : FollowUp {
            override val kinds get() = setOf(StockKind.SETS)
        }

        data class WantedItemMoved(val setNumber: String, val zustand: Zustand, val von: Int, val zu: Int) : FollowUp {
            override val kinds get() = setOf(StockKind.MERKLISTE)
        }

        /** The wishlist item goes into the collection: out of the wishlist, into the gallery. */
        data class WantedItemAdopted(val setNumber: String, val zustand: Zustand, val besitzer: Int?,
                                         val wish: Erfassungswunsch) : FollowUp {
            override val kinds get() = setOf(StockKind.MERKLISTE, StockKind.SETS)
        }

        data class PartLocation(val partNumber: String, val colorId: Int, val ort: String?) : FollowUp {
            override val kinds get() = setOf(StockKind.MANUELLE_TEILE)
        }

        /** The color is part of the key: if it hits an existing row, the server merges both. */
        data class PartColor(val partNumber: String, val colorId: Int, val neueFarbe: Int, val farbName: String?,
                             val farbHex: String?, val besitzer: Int?) : FollowUp {
            override val kinds get() = setOf(StockKind.MANUELLE_TEILE)
        }

        data class MinifigLocation(val figNumber: String, val ort: String?) : FollowUp {
            override val kinds get() = setOf(StockKind.MANUELLE_FIGUREN)
        }

        /** A renamed place has the new name everywhere it stood, also in the supply. */
        data class LocationRenamed(val alt: String, val neu: LocationEntryView) : FollowUp {
            override val kinds get() = setOf(StockKind.SETS, StockKind.MANUELLE_TEILE, StockKind.MANUELLE_FIGUREN,
                StockKind.LAGERORTE)
        }

        data class LocationCreated(val ort: LocationEntryView) : FollowUp {
            override val kinds get() = setOf(StockKind.LAGERORTE)
        }

        data class LocationDeleted(val id: Int) : FollowUp {
            override val kinds get() = setOf(StockKind.LAGERORTE)
        }

        /** null: no default any more. */
        data class LocationDefault(val id: Int?) : FollowUp {
            override val kinds get() = setOf(StockKind.LAGERORTE)
        }

        /** The server sends back the saved alert; it replaces that of the set in the same condition. */
        data class AlarmSet(val alarm: PriceAlertView) : FollowUp {
            override val kinds get() = setOf(StockKind.PREISALARME)
        }

        data class AlarmRemoved(val setNumber: String, val zustand: Zustand) : FollowUp {
            override val kinds get() = setOf(StockKind.PREISALARME)
        }
    }

    private val aktuell: Flow<String?> = areaFlow.map { gueltig(it) }.distinctUntilChanged()

    /**
     * One lock per area and list: reading, changing and writing a list
     * must not overtake each other, otherwise the later write overwrites the
     * earlier one (lost change).
     */
    private val sperren = ConcurrentHashMap<Pair<String, StockKind>, Mutex>()

    private fun lock(b: String, art: StockKind) = sperren.getOrPut(b to art) { Mutex() }

    /** The valid area, scattered; null = not signed in, then nothing is stored. */
    suspend fun bereich(): String? = gueltig(fangeAusserAbbruch { areaSource() }.getOrNull())

    private fun gueltig(b: String?) = b?.takeIf { it.isNotBlank() }

    /** What the server rejected and has not been reported yet, for the current area. */
    @OptIn(ExperimentalCoroutinesApi::class)
    fun discarded(): Flow<List<DiscardedItem>> =
        aktuell.flatMapLatest { b -> if (b == null) flowOf(emptyList()) else ausgang.discarded(b) }

    /** The hint for [id] has been shown; the item may go. */
    suspend fun acknowledgeDiscarded(id: String) {
        val b = bereich() ?: return
        ausgang.acknowledgeDiscarded(b, id)
    }

    /** How many edits are still waiting for the server. */
    @OptIn(ExperimentalCoroutinesApi::class)
    fun offene(): Flow<Int> = aktuell.flatMapLatest { b -> if (b == null) flowOf(0) else ausgang.anzahl(b) }

    @OptIn(ExperimentalCoroutinesApi::class)
    fun <T : Any> observe(fach: Fach<T>): Flow<Local<T>> = aktuell.flatMapLatest { b ->
        if (b == null) flowOf(Local(emptyList(), null))
        else bestand.observe(b, fach.art).map { decode(fach, it) }
    }

    /**
     * Every later change to one of the [slots] — for key figures the
     * server calculates over these lists. The store is the source: what it does not
     * change triggers nothing.
     */
    fun altered(vararg slots: Fach<*>): Flow<Unit> =
        merge(*slots.map { f -> observe(f).map { it.liste }.distinctUntilChanged().drop(1).map { } }.toTypedArray())

    /**
     * The local list, only with the rows [filter] matches — asked anew on every change,
     * so that what was changed offline also appears in a filtered view.
     */
    @OptIn(ExperimentalCoroutinesApi::class)
    fun <T : Any> observe(fach: Fach<T>, filter: Filterspalten): Flow<Local<T>> =
        if (filter == Filterspalten()) observe(fach)
        else observe(fach).mapLatest { alle -> if (alle.stand == null) alle else filtere(fach, filter) ?: alle }

    suspend fun <T : Any> lies(fach: Fach<T>): Local<T>? {
        val b = bereich() ?: return null
        return decode(fach, bestand.lies(b, fach.art))
    }

    /** The local list, only with the rows [filter] matches; null if nobody is signed in. */
    suspend fun <T : Any> filtere(fach: Fach<T>, filter: Filterspalten): Local<T>? {
        val b = bereich() ?: return null
        return decode(fach, bestand.filtere(b, fach.art, filter))
    }

    /** Take over the server's whole list; whatever is still waiting lies over it again afterwards. */
    suspend fun <T : Any> adopt(fach: Fach<T>, liste: List<T>, bereich: String? = null) {
        val b = bereich ?: bereich() ?: return
        bestand.cleanOther(b)
        // Under the lock: a puffere() between reading the outbox and
        // writing would otherwise get lost with the server list.
        lock(b, fach.art).withLock {
            val waiting = ausgang.alle(b).map { it.bearbeitung }.filter { it.art == fach.art }
            var zusammen = liste
            for (w in waiting) zusammen = fach.anwenden(zusammen, w)
            bestand.ersetze(b, fach.art, encode(fach, zusammen), clock())
        }
    }

    /**
     * Is something still waiting for the current area (for [art] or at all)?
     * Then new things must go behind it, otherwise the order tips over.
     */
    suspend fun wartet(art: StockKind? = null): Boolean {
        val b = bereich() ?: return false
        return if (art == null) ausgang.erster(b) != null else ausgang.alle(b).any { it.bearbeitung.art == art }
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
    suspend fun buffer(bearbeitung: Editing, schluessel: String = newKey()): Boolean {
        val b = bereich() ?: return false
        // Enqueue and apply in one go: uebernimm() sees both or neither.
        lock(b, bearbeitung.art).withLock {
            ausgang.einreihen(b, bearbeitung, clock(), schluessel)
            applyAnLocked(bearbeitung.art, bearbeitung, b)
        }
        runCatching { planner.plane() }
        return true
    }

    /** Apply what succeeded online locally too, so that the list is right immediately. */
    suspend fun applyAn(effect: Wirkung, bereich: String? = null) {
        val b = bereich ?: bereich() ?: return
        // One list after another, never two locks at once: this way nothing can deadlock.
        for (art in effect.kinds) lock(b, art).withLock { applyAnLocked(art, effect, b) }
    }

    private suspend fun applyAnLocked(art: StockKind, w: Wirkung, b: String) = when (art) {
        StockKind.SETS -> aendere(Slots.SETS, b, w)
        StockKind.MERKLISTE -> aendere(Slots.MERKLISTE, b, w)
        StockKind.MANUELLE_TEILE -> aendere(Slots.MANUELLE_TEILE, b, w)
        StockKind.MANUELLE_FIGUREN -> aendere(Slots.MANUELLE_FIGUREN, b, w)
        StockKind.PREISALARME -> aendere(Slots.PREISALARME, b, w)
        StockKind.LAGERORTE -> aendere(Slots.LAGERORTE, b, w)
        // Only delivered by the server, never edited locally.
        StockKind.TEILE, StockKind.FIGUREN, StockKind.GUTSCHEINE, StockKind.KENNZAHLEN,
        StockKind.KATALOG_META -> Unit
    }

    /** Trigger sending, e.g. at start, in case something is still waiting from last time. */
    fun sendPlane() = runCatching { planner.plane() }

    /** On sign-out: lists and outbox of all areas. */
    suspend fun leere() {
        bestand.leere()
        ausgang.leere()
    }

    /** Call only under the lock of ([b], fach.art). */
    private suspend fun <T : Any> aendere(fach: Fach<T>, b: String, w: Wirkung) {
        val alt = decode(fach, bestand.lies(b, fach.art))
        bestand.sameAn(b, fach.art, encode(fach, fach.anwenden(alt.liste, w)))
    }

    private fun <T : Any> encode(fach: Fach<T>, liste: List<T>) =
        liste.map { LocalRow(fach.schluessel(it), fach.form.encode(json, it), fach.spalten(it)) }

    /**
     * Rows that can no longer be read are dropped instead of blocking the list —
     * but not silently: their number stands in [Local.verworfen] and goes into the [protokoll].
     */
    private fun <T : Any> decode(fach: Fach<T>, l: Local<LocalRow>): Local<T> {
        val gelesen = l.liste.mapNotNull { z -> runCatching { fach.form.decode(json, z.inhalt) }.getOrNull() }
        val verworfen = l.liste.size - gelesen.size
        if (verworfen > 0) protokoll("Ablage ${fach.art}: $verworfen von ${l.liste.size} Zeilen unlesbar, verworfen")
        return Local(gelesen, l.stand, verworfen)
    }
}
