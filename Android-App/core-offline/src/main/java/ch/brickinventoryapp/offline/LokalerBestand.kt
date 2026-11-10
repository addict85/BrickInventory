package ch.brickinventoryapp.offline

import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.update

/** Die Listen, die die App lokal führt. Der Name steht in der Datenbank — nicht umbenennen. */
enum class Bestandsart { SETS, MERKLISTE, TEILE, FIGUREN, MANUELLE_TEILE, MANUELLE_FIGUREN, GUTSCHEINE }

/**
 * Die Spalten, nach denen ohne Netz gefiltert wird — dieselben Felder, die der
 * Server vergleicht. [suchtext] trägt die durchsuchten Felder klein geschrieben,
 * durch Zeilenumbrüche getrennt, damit kein Treffer über eine Feldgrenze reicht.
 */
data class Merkmale(
    val suchtext: String = "",
    val thema: String? = null,
    val lagerort: String? = null,
    val farbe: String? = null,
    val kategorie: String? = null,
    val ersatzteil: Boolean? = null,
    val zustand: String? = null,
)

/** Eine Zeile: Schlüssel, das Modell, wie der Server es geliefert hat (JSON), und seine Filterspalten. */
data class LokaleZeile(val schluessel: String, val inhalt: String, val merkmale: Merkmale = Merkmale())

/** Eine ganze Liste samt dem Zeitpunkt, an dem der Server sie zuletzt geliefert hat. */
data class LokaleListe(val zeilen: List<LokaleZeile>, val stand: Long?)

/** Die Filter einer Abfrage, wie sie zum Server gingen; null heisst „nicht eingeschränkt“. */
data class Bestandsfilter(
    val suche: String? = null,
    val thema: String? = null,
    val lagerort: String? = null,
    val farbe: String? = null,
    val kategorie: String? = null,
    val ersatzteil: Boolean? = null,
    val zustand: String? = null,
) {
    /** Wie die Abfrage in Room, für die Ablage im Speicher: enthält, ohne Gross und Klein. */
    fun trifft(m: Merkmale): Boolean =
        (suche == null || m.suchtext.contains(suche.lowercase())) &&
            (thema == null || m.thema == thema) && (lagerort == null || m.lagerort == lagerort) &&
            (farbe == null || m.farbe == farbe) && (kategorie == null || m.kategorie == kategorie) &&
            (ersatzteil == null || m.ersatzteil == ersatzteil) && (zustand == null || m.zustand == zustand)
}

/**
 * Die lokale Ablage des Bestands, je Bereich (Server und Konto) getrennt. Im
 * Gerät Room ([ch.brickinventoryapp.offline.room.RoomBestand]); die
 * Schnittstelle hält die Abgleichslogik ohne Android prüfbar.
 */
interface LokalerBestand {
    fun beobachte(bereich: String, art: Bestandsart): Flow<LokaleListe>
    suspend fun lies(bereich: String, art: Bestandsart): LokaleListe
    /** Nur die Zeilen, die [filter] trifft, in der Reihenfolge der Liste. */
    suspend fun filtere(bereich: String, art: Bestandsart, filter: Bestandsfilter): LokaleListe
    /** Ersetzt die Liste; [stand] null heisst „lokal geändert, Serverstand bleibt“. */
    suspend fun ersetze(bereich: String, art: Bestandsart, zeilen: List<LokaleZeile>, stand: Long?)
    /**
     * Eine weitere Seite: [zeilen] hinten anfügen (gleicher Schlüssel ersetzt),
     * [weg] entfernen. Der Rest der Liste wird dabei weder gelesen noch geschrieben.
     */
    suspend fun haengeAn(bereich: String, art: Bestandsart, zeilen: List<LokaleZeile>, weg: Set<String>, stand: Long)
    /** Alles löschen, was nicht zu [bereich] gehört — auf dem Gerät ist immer nur ein Konto angemeldet. */
    suspend fun raeumeAndere(bereich: String)
    suspend fun leere()
}

/** Im Speicher: für Tests und als Vorgabe, solange keine Datenbank gebunden ist. */
class SpeicherBestand : LokalerBestand {
    private val daten = MutableStateFlow<Map<Pair<String, Bestandsart>, LokaleListe>>(emptyMap())

    override fun beobachte(bereich: String, art: Bestandsart): Flow<LokaleListe> =
        daten.map { it[bereich to art] ?: LokaleListe(emptyList(), null) }.distinctUntilChanged()

    override suspend fun lies(bereich: String, art: Bestandsart) =
        daten.value[bereich to art] ?: LokaleListe(emptyList(), null)

    override suspend fun filtere(bereich: String, art: Bestandsart, filter: Bestandsfilter) =
        lies(bereich, art).let { l -> l.copy(zeilen = l.zeilen.filter { filter.trifft(it.merkmale) }) }

    override suspend fun ersetze(bereich: String, art: Bestandsart, zeilen: List<LokaleZeile>, stand: Long?) =
        daten.update { alt ->
            alt + ((bereich to art) to LokaleListe(zeilen.associateBy { it.schluessel }.values.toList(),
                stand ?: alt[bereich to art]?.stand))
        }

    override suspend fun haengeAn(bereich: String, art: Bestandsart, zeilen: List<LokaleZeile>, weg: Set<String>, stand: Long) =
        daten.update { alt ->
            val neu = zeilen.associateBy { it.schluessel }
            val bisher = alt[bereich to art]?.zeilen.orEmpty().filterNot { it.schluessel in weg || it.schluessel in neu }
            alt + ((bereich to art) to LokaleListe(bisher + neu.values, stand))
        }

    override suspend fun raeumeAndere(bereich: String) = daten.update { alt -> alt.filterKeys { it.first == bereich } }

    override suspend fun leere() { daten.value = emptyMap() }
}
