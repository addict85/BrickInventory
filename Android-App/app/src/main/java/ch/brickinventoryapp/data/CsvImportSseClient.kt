package ch.brickinventoryapp.data

import ch.brickinventoryapp.data.model.CsvImportStatus
import kotlinx.coroutines.channels.awaitClose
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.callbackFlow
import kotlinx.coroutines.flow.first
import kotlinx.serialization.json.Json
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okhttp3.sse.EventSource
import okhttp3.sse.EventSourceListener
import okhttp3.sse.EventSources
import javax.inject.Inject
import javax.inject.Named
import javax.inject.Singleton

/**
 * Persistenter SSE-Client für den CSV-Import-Kanal.
 *
 * Die Verbindung bleibt dauerhaft offen (auch wenn kein Import läuft).
 * Startet jemand einen Import — egal ob über die Webapp, die App oder ein
 * anderes Gerät — kommt das erste Event sofort, ohne vorher pollen zu müssen.
 *
 * Events:
 *  - [Event.Status] : Statusänderung (Fortschritt, Start, Ende, idle)
 *  - [Event.Failed] : Verbindungsfehler → Aufrufer soll auf Polling zurückfallen
 *
 * Der Flow schließt sich NUR bei Verbindungsfehler, nicht mehr bei Import-Ende.
 * Das ViewModel reconnectet automatisch bei Fehler (mit Backoff).
 */
@Singleton
class CsvImportSseClient @Inject constructor(
    // @param: explizit — Kotlin 2.2+ ändert das Default-Ziel von Annotationen auf
    // val-Konstruktorparametern (künftig Parameter UND Property). Für Dagger/Hilt
    // zählt der Parameter; der Use-Site-Target macht das eindeutig.
    @param:Named("sse") private val client: OkHttpClient,
    private val prefs: PreferencesManager,
    private val json: Json
) {
    sealed class Event {
        /** Statusänderung vom Server (inkl. idle-Zustand wenn kein Import läuft). */
        data class Status(val status: CsvImportStatus) : Event()
        /** Verbindungsfehler — Aufrufer soll auf Polling zurückfallen. */
        /**
         * Verbindungsfehler. [technisch] ist AUSSCHLIESSLICH fürs Log — der
         * Aufrufer (CsvImportFeature) setzt daraufhin nur `sseFailed = true`
         * und fällt auf Polling zurück; dem Nutzer wird nichts davon gezeigt.
         * Deshalb steht hier kein übersetzbarer Text, sondern eine Ursache in
         * technischer Form (Nachtrag 116).
         */
        data class Failed(val technisch: String?) : Event()
    }

    /**
     * Öffnet eine persistente SSE-Verbindung und emittiert jeden Status,
     * den der Server schickt. Schließt sich nur bei Verbindungsfehler.
     * cold Flow — Verbindung wird beim Collect aufgebaut, beim Cancel geschlossen.
     */
    fun stream(): Flow<Event> = callbackFlow {
        val baseUrl = prefs.serverUrl.first().trim().trimEnd('/')
        val token   = prefs.authToken.first()

        if (baseUrl.isBlank() || token.isBlank()) {
            trySend(Event.Failed("no server url or token"))
            close()
            return@callbackFlow
        }

        val request = Request.Builder()
            // Umgezogen nach /api/v1 — ein Adressraum (siehe server.ts).
            .url("$baseUrl/api/v1/sets/import/csv/stream")
            .header("Authorization", "Bearer $token")
            .header("Accept", "text/event-stream")
            .build()

        val listener = object : EventSourceListener() {
            override fun onEvent(
                eventSource: EventSource,
                id: String?,
                type: String?,
                data: String
            ) {
                if (data.isBlank()) return
                try {
                    val status = json.decodeFromString(CsvImportStatus.serializer(), data)
                    trySend(Event.Status(status))
                    // Verbindung NICHT schließen — offen lassen für nächsten Import.
                } catch (_: Exception) {
                    // Unlesbares Event ignorieren (z. B. Heartbeat-Kommentar,
                    // obwohl der Server `: keep-alive` als Kommentarzeile schickt
                    // und okhttp-sse das nicht als onEvent liefert).
                }
            }

            override fun onClosed(eventSource: EventSource) {
                // Server hat die Verbindung beendet (Neustart, Deploy etc.)
                // Als Failed melden, damit der Aufrufer reconnectet.
                trySend(Event.Failed("stream closed by server"))
                close()
            }

            override fun onFailure(
                eventSource: EventSource,
                t: Throwable?,
                response: Response?
            ) {
                val msg = when {
                    response != null -> "HTTP ${response.code}"
                    else             -> t?.message
                }
                trySend(Event.Failed(msg))
                close()
            }
        }

        val eventSource = EventSources.createFactory(client)
            .newEventSource(request, listener)

        awaitClose { eventSource.cancel() }
    }
}
