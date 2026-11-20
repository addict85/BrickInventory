package ch.brickinventoryapp.data

import ch.brickinventoryapp.data.di.SseClient
import ch.brickinventoryapp.network.di.PLACEHOLDER_BASE
import ch.brickinventoryapp.contract.CsvImportStatus
import ch.brickinventoryapp.contract.mapping.alsAnsicht
import ch.brickinventoryapp.model.domain.CsvImportStatusView
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
interface CsvImportStream {
    fun stream(): Flow<CsvImportSseClient.Event>
}

/**
 * Persistenter SSE-Client für den CSV-Import-Kanal.
 * Die Verbindung bleibt auch ohne laufenden Import offen: Startet ihn jemand auf einem anderen
 * Gerät, kommt das erste Ereignis sofort statt erst beim nächsten Abfragen.
 */
@Singleton
class CsvImportSseClient @Inject constructor(
    // @param: explizit — Kotlin 2.2+ ändert das Default-Ziel von Annotationen auf
    // val-Konstruktorparametern (künftig Parameter UND Property). Für Dagger/Hilt
    // zählt der Parameter; der Use-Site-Target macht das eindeutig.
    @param:SseClient private val client: OkHttpClient,
    private val json: Json
) : CsvImportStream {
    sealed class Event {
        /** Statusänderung vom Server (inkl. idle-Zustand wenn kein Import läuft). */
        data class Status(val status: CsvImportStatusView) : Event()
        /**
         * Verbindungsfehler. [technical] ist ausschliesslich fürs Log: Der Aufrufer
         * (CsvImportService über folgeStrom) fällt auf Polling zurück, dem Nutzer wird
         * nichts gezeigt — deshalb kein übersetzbarer
         * Text, sondern die Ursache in technischer Form.
         */
        data class Failed(val technical: String?) : Event()
    }

    /**
     * Öffnet eine persistente SSE-Verbindung und emittiert jeden Status,
     * den der Server schickt. Schließt sich nur bei Verbindungsfehler.
     * cold Flow — Verbindung wird beim Collect aufgebaut, beim Cancel geschlossen.
     */
    override fun stream(): Flow<Event> = flow {
        // Adresse und Token setzt der Wächter des Clients wie bei jedem Abruf; ohne
        // Anmeldung antwortet der Server 401, und der Aufrufer fragt später wieder.
        val request = Request.Builder()
            .url("${PLACEHOLDER_BASE}api/v1/sets/import/csv/stream")
            .header("Accept", "text/event-stream")
            .build()

        // Verbindung NICHT schließen, solange Status kommen — offen lassen für nächsten Import.
        // Jedes andere Ende (auch ein unlesbares Ereignis) heisst Failed: Der Aufrufer
        // reconnectet bzw. pollt, statt auf einen Status zu warten, der nie kommt.
        val events = sseStream(client, request) { json.decodeFromString(CsvImportStatus.serializer(), it) }
        emitAll(events.map { e ->
            when (e) {
                is SseEvent.Daten      -> Event.Status(e.wert.alsAnsicht())
                is SseEvent.Unlesbar   -> Event.Failed("unreadable event: ${e.technical}")
                is SseEvent.Ended    -> Event.Failed("stream closed by server")
                is SseEvent.Gescheitert -> Event.Failed(e.code?.let { "HTTP $it" } ?: e.technical)
            }
        })
    }
}
