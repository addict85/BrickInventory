package ch.brickinventoryapp.offline

import ch.brickinventoryapp.model.lokal.Bestandsart
import ch.brickinventoryapp.model.lokal.Lokal
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
    fun trifft(zeile: Filterspalten): Boolean =
        (suchtext == null || zeile.suchtext.orEmpty().contains(suchtext.lowercase())) &&
            (thema == null || zeile.thema == thema) && (lagerort == null || zeile.lagerort == lagerort) &&
            (farbe == null || zeile.farbe == farbe) && (kategorie == null || zeile.kategorie == kategorie) &&
            (ersatzteil == null || zeile.ersatzteil == ersatzteil) && (zustand == null || zeile.zustand == zustand)
}

/** Eine Zeile: Schlüssel, das Modell, wie der Server es geliefert hat (JSON), und seine Filterspalten. */
data class LokaleZeile(val schluessel: String, val inhalt: String, val spalten: Filterspalten = Filterspalten())

/**
 * Die lokale Ablage des Bestands, je Bereich (Server und Konto) getrennt. Im
 * Gerät Room ([ch.brickinventoryapp.offline.room.RoomBestand]); die
 * Schnittstelle hält die Abgleichslogik ohne Android prüfbar. Eine Liste kommt
 * als [Lokal] mit dem Zeitpunkt, an dem der Server sie zuletzt geliefert hat.
 */
interface LokalerBestand {
    fun beobachte(bereich: String, art: Bestandsart): Flow<Lokal<LokaleZeile>>
    suspend fun lies(bereich: String, art: Bestandsart): Lokal<LokaleZeile>
    /** Nur die Zeilen, die [filter] trifft, in der Reihenfolge der Liste. */
    suspend fun filtere(bereich: String, art: Bestandsart, filter: Filterspalten): Lokal<LokaleZeile>
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
    private val daten = MutableStateFlow<Map<Pair<String, Bestandsart>, Lokal<LokaleZeile>>>(emptyMap())

    override fun beobachte(bereich: String, art: Bestandsart): Flow<Lokal<LokaleZeile>> =
        daten.map { it[bereich to art] ?: Lokal(emptyList(), null) }.distinctUntilChanged()

    override suspend fun lies(bereich: String, art: Bestandsart) =
        daten.value[bereich to art] ?: Lokal(emptyList(), null)

    override suspend fun filtere(bereich: String, art: Bestandsart, filter: Filterspalten) =
        lies(bereich, art).let { l -> l.copy(liste = l.liste.filter { filter.trifft(it.spalten) }) }

    override suspend fun ersetze(bereich: String, art: Bestandsart, zeilen: List<LokaleZeile>, stand: Long?) =
        daten.update { alt ->
            alt + ((bereich to art) to Lokal(zeilen.associateBy { it.schluessel }.values.toList(),
                stand ?: alt[bereich to art]?.stand))
        }

    override suspend fun haengeAn(bereich: String, art: Bestandsart, zeilen: List<LokaleZeile>, weg: Set<String>, stand: Long) =
        daten.update { alt ->
            val neu = zeilen.associateBy { it.schluessel }
            val bisher = alt[bereich to art]?.liste.orEmpty().filterNot { it.schluessel in weg || it.schluessel in neu }
            alt + ((bereich to art) to Lokal(bisher + neu.values, stand))
        }

    override suspend fun raeumeAndere(bereich: String) = daten.update { alt -> alt.filterKeys { it.first == bereich } }

    override suspend fun leere() { daten.value = emptyMap() }
}
