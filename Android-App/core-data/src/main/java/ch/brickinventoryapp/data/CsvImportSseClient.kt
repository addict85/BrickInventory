package ch.brickinventoryapp.data

import ch.brickinventoryapp.data.di.SseClient
import ch.brickinventoryapp.model.data.model.CsvImportStatus
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.emitAll
import kotlinx.coroutines.flow.flow
import kotlinx.coroutines.flow.map
import kotlinx.serialization.json.Json
import okhttp3.OkHttpClient
import okhttp3.Request
import javax.inject.Inject
import javax.inject.Singleton

/** Die Schritte eines CSV-Imports, solange jemand sammelt; im Test eine Folge aus dem Speicher. */
interface CsvImportStrom {
    fun stream(): Flow<CsvImportSseClient.Event>
}

/**
 * Persistenter SSE-Client für den CSV-Import-Kanal.
 * Ausführlich: docs/begruendungen/core-data/data/CsvImportSseClient.kt.md#constructor
 */
@Singleton
class CsvImportSseClient @Inject constructor(
    // @param: explizit — Kotlin 2.2+ ändert das Default-Ziel von Annotationen auf
    // val-Konstruktorparametern (künftig Parameter UND Property). Für Dagger/Hilt
    // zählt der Parameter; der Use-Site-Target macht das eindeutig.
    @param:SseClient private val client: OkHttpClient,
    private val prefs: Zugangsdaten,
    private val json: Json
) : CsvImportStrom {
    sealed class Event {
        /** Statusänderung vom Server (inkl. idle-Zustand wenn kein Import läuft). */
        data class Status(val status: CsvImportStatus) : Event()
        /**
         * Verbindungsfehler. [technisch] ist ausschliesslich fürs Log: Der Aufrufer
         * (CsvImportService über folgeStrom) fällt auf Polling zurück, dem Nutzer wird
         * nichts gezeigt — deshalb kein übersetzbarer
         * Text, sondern die Ursache in technischer Form.
         */
        data class Failed(val technisch: String?) : Event()
    }

    /**
     * Öffnet eine persistente SSE-Verbindung und emittiert jeden Status,
     * den der Server schickt. Schließt sich nur bei Verbindungsfehler.
     * cold Flow — Verbindung wird beim Collect aufgebaut, beim Cancel geschlossen.
     */
    override fun stream(): Flow<Event> = flow {
        val baseUrl = prefs.serverUrlJetzt().trim().trimEnd('/')
        val token   = prefs.tokenJetzt()

        if (baseUrl.isBlank() || token.isBlank()) {
            emit(Event.Failed("no server url or token"))
            return@flow
        }

        val request = Request.Builder()
            // Umgezogen nach /api/v1 — ein Adressraum (siehe server.ts).
            .url("$baseUrl/api/v1/sets/import/csv/stream")
            .header("Authorization", "Bearer $token")
            .header("Accept", "text/event-stream")
            .build()

        // Verbindung NICHT schließen, solange Status kommen — offen lassen für nächsten Import.
        // Jedes andere Ende (auch ein unlesbares Ereignis) heisst Failed: Der Aufrufer
        // reconnectet bzw. pollt, statt auf einen Status zu warten, der nie kommt.
        val ereignisse = sseStrom(client, request) { json.decodeFromString(CsvImportStatus.serializer(), it) }
        emitAll(ereignisse.map { e ->
            when (e) {
                is SseEreignis.Daten      -> Event.Status(e.wert)
                is SseEreignis.Unlesbar   -> Event.Failed("unreadable event: ${e.technisch}")
                is SseEreignis.Beendet    -> Event.Failed("stream closed by server")
                is SseEreignis.Gescheitert -> Event.Failed(e.code?.let { "HTTP $it" } ?: e.technisch)
            }
        })
    }
}
