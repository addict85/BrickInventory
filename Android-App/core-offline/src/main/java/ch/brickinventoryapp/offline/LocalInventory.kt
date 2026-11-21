package ch.brickinventoryapp.offline

import ch.brickinventoryapp.model.local.StockKind
import ch.brickinventoryapp.model.local.Local
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.update

/**
 * The columns the server filters by — on a row their values, in a
 * query the pattern: what is set must be equal, [suchtext] contained
 * (case-insensitive). On the row [suchtext] carries the searched fields,
 * separated by line breaks, so that no hit reaches across a field boundary.
 */
data class Filterspalten(
    val suchtext: String? = null,
    val thema: String? = null,
    val lagerort: String? = null,
    val farbe: String? = null,
    val kategorie: String? = null,
    val ersatzteil: Boolean? = null,
    val zustand: String? = null,
) {
    /** Like the query in Room, for the in-memory store. */
    fun hits(zeile: Filterspalten): Boolean =
        (suchtext == null || zeile.suchtext.orEmpty().contains(suchtext.lowercase())) &&
            (thema == null || zeile.thema == thema) && (lagerort == null || zeile.lagerort == lagerort) &&
            (farbe == null || zeile.farbe == farbe) && (kategorie == null || zeile.kategorie == kategorie) &&
            (ersatzteil == null || zeile.ersatzteil == ersatzteil) && (zustand == null || zeile.zustand == zustand)
}

/** A row: key, the model as the server delivered it (JSON), and its filter columns. */
data class LocalRow(val schluessel: String, val inhalt: String, val spalten: Filterspalten = Filterspalten())

/**
 * The local store of the stock, separated per area (server and account). On the
 * device Room ([ch.brickinventoryapp.offline.room.RoomInventory]); the
 * interface keeps the sync logic testable without Android. A list comes
 * as [Local] with the point in time at which the server last delivered it.
 */
interface LocalInventory {
    fun observe(bereich: String, art: StockKind): Flow<Local<LocalRow>>
    suspend fun lies(bereich: String, art: StockKind): Local<LocalRow>
    /** Only the rows that [filter] matches, in the order of the list. */
    suspend fun filtere(bereich: String, art: StockKind, filter: Filterspalten): Local<LocalRow>
    /** Replaces the list; [stand] null means „changed locally, server state stays“. */
    suspend fun ersetze(bereich: String, art: StockKind, zeilen: List<LocalRow>, stand: Long?)
    /** Like [ersetze] without state, but writes only new, changed and deleted rows. */
    suspend fun sameAn(bereich: String, art: StockKind, zeilen: List<LocalRow>)
    /** Delete everything that does not belong to [bereich] — on the device only one account is ever signed in. */
    suspend fun cleanOther(bereich: String)
    suspend fun leere()
}

/** In memory: for tests and as the default as long as no database is bound. */
class StorageInventory : LocalInventory {
    private val daten = MutableStateFlow<Map<Pair<String, StockKind>, Local<LocalRow>>>(emptyMap())

    override fun observe(bereich: String, art: StockKind): Flow<Local<LocalRow>> =
        daten.map { it[bereich to art] ?: Local(emptyList(), null) }.distinctUntilChanged()

    override suspend fun lies(bereich: String, art: StockKind) =
        daten.value[bereich to art] ?: Local(emptyList(), null)

    override suspend fun filtere(bereich: String, art: StockKind, filter: Filterspalten) =
        lies(bereich, art).let { l -> l.copy(liste = l.liste.filter { filter.hits(it.spalten) }) }

    override suspend fun ersetze(bereich: String, art: StockKind, zeilen: List<LocalRow>, stand: Long?) =
        daten.update { alt ->
            alt + ((bereich to art) to Local(zeilen.associateBy { it.schluessel }.values.toList(),
                stand ?: alt[bereich to art]?.stand))
        }

    override suspend fun sameAn(bereich: String, art: StockKind, zeilen: List<LocalRow>) =
        ersetze(bereich, art, zeilen, null)

    override suspend fun cleanOther(bereich: String) = daten.update { alt -> alt.filterKeys { it.first == bereich } }

    override suspend fun leere() { daten.value = emptyMap() }
}
