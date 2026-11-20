package ch.brickinventoryapp.offline

import ch.brickinventoryapp.model.lokal.StockKind
import ch.brickinventoryapp.model.lokal.Local
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.update

/**
 * Die Spalten, nach denen der Server filtert — an einer Zeile ihre Werte, in einer
 * Abfrage das Muster: Was gesetzt ist, muss gleich sein, [suchtext] enthalten
 * (ohne Gross und Klein). An der Zeile trägt [suchtext] die durchsuchten Felder,
 * durch Zeilenumbrüche getrennt, damit kein Treffer über eine Feldgrenze reicht.
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
    /** Wie die Abfrage in Room, für die Ablage im Speicher. */
    fun hits(zeile: Filterspalten): Boolean =
        (suchtext == null || zeile.suchtext.orEmpty().contains(suchtext.lowercase())) &&
            (thema == null || zeile.thema == thema) && (lagerort == null || zeile.lagerort == lagerort) &&
            (farbe == null || zeile.farbe == farbe) && (kategorie == null || zeile.kategorie == kategorie) &&
            (ersatzteil == null || zeile.ersatzteil == ersatzteil) && (zustand == null || zeile.zustand == zustand)
}

/** Eine Zeile: Schlüssel, das Modell, wie der Server es geliefert hat (JSON), und seine Filterspalten. */
data class LocalRow(val schluessel: String, val inhalt: String, val spalten: Filterspalten = Filterspalten())

/**
 * Die lokale Ablage des Bestands, je Bereich (Server und Konto) getrennt. Im
 * Gerät Room ([ch.brickinventoryapp.offline.room.RoomInventory]); die
 * Schnittstelle hält die Abgleichslogik ohne Android prüfbar. Eine Liste kommt
 * als [Local] mit dem Zeitpunkt, an dem der Server sie zuletzt geliefert hat.
 */
interface LocalInventory {
    fun observe(bereich: String, art: StockKind): Flow<Local<LocalRow>>
    suspend fun lies(bereich: String, art: StockKind): Local<LocalRow>
    /** Nur die Zeilen, die [filter] trifft, in der Reihenfolge der Liste. */
    suspend fun filtere(bereich: String, art: StockKind, filter: Filterspalten): Local<LocalRow>
    /** Ersetzt die Liste; [stand] null heisst „lokal geändert, Serverstand bleibt“. */
    suspend fun ersetze(bereich: String, art: StockKind, zeilen: List<LocalRow>, stand: Long?)
    /** Wie [ersetze] ohne Stand, schreibt aber nur neue, geänderte und gelöschte Zeilen. */
    suspend fun sameAn(bereich: String, art: StockKind, zeilen: List<LocalRow>)
    /** Alles löschen, was nicht zu [bereich] gehört — auf dem Gerät ist immer nur ein Konto angemeldet. */
    suspend fun cleanOther(bereich: String)
    suspend fun leere()
}

/** Im Speicher: für Tests und als Vorgabe, solange keine Datenbank gebunden ist. */
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
