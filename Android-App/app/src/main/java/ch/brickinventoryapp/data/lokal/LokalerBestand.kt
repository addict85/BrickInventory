package ch.brickinventoryapp.data.lokal

import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.update

/** Die Listen, die die App lokal führt. Der Name steht in der Datenbank — nicht umbenennen. */
enum class Bestandsart { SETS, MERKLISTE, TEILE, FIGUREN, MANUELLE_TEILE, MANUELLE_FIGUREN, GUTSCHEINE }

/** Eine Zeile: Schlüssel und das Modell, wie der Server es geliefert hat (JSON). */
data class LokaleZeile(val schluessel: String, val inhalt: String)

/** Eine ganze Liste samt dem Zeitpunkt, an dem der Server sie zuletzt geliefert hat. */
data class LokaleListe(val zeilen: List<LokaleZeile>, val stand: Long?)

/**
 * Die lokale Ablage des Bestands, je Bereich (Server und Konto) getrennt. Im
 * Gerät Room ([ch.brickinventoryapp.data.lokal.room.RoomBestand]); die
 * Schnittstelle hält die Abgleichslogik ohne Android prüfbar.
 *
 * Zeilen tragen das Server-Modell als JSON: Die App filtert und sortiert auf dem
 * Server, lokal braucht es nur Schlüssel und Reihenfolge.
 */
interface LokalerBestand {
    fun beobachte(bereich: String, art: Bestandsart): Flow<LokaleListe>
    suspend fun lies(bereich: String, art: Bestandsart): LokaleListe
    /** Ersetzt die Liste; [stand] null heisst „lokal geändert, Serverstand bleibt“. */
    suspend fun ersetze(bereich: String, art: Bestandsart, zeilen: List<LokaleZeile>, stand: Long?)
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

    override suspend fun ersetze(bereich: String, art: Bestandsart, zeilen: List<LokaleZeile>, stand: Long?) =
        daten.update { alt ->
            alt + ((bereich to art) to LokaleListe(zeilen, stand ?: alt[bereich to art]?.stand))
        }

    override suspend fun raeumeAndere(bereich: String) = daten.update { alt -> alt.filterKeys { it.first == bereich } }

    override suspend fun leere() { daten.value = emptyMap() }
}
