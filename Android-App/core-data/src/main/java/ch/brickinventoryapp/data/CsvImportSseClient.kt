package ch.brickinventoryapp.data

import ch.brickinventoryapp.data.di.SseClient
import ch.brickinventoryapp.network.di.PLACEHOLDER_BASE
import ch.brickinventoryapp.contract.CsvImportStatus
import ch.brickinventoryapp.contract.mapping.asView
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

/** The steps of a CSV import as long as someone collects; in the test a sequence from memory. */
interface CsvImportStream {
    fun stream(): Flow<CsvImportSseClient.Event>
}

/**
 * Persistent SSE client for the CSV import channel.
 * The connection stays open even without a running import: if someone starts one on another
 * device, the first event comes immediately instead of only at the next poll.
 */
@Singleton
class CsvImportSseClient @Inject constructor(
    // @param: explicit — Kotlin 2.2+ changes the default target of annotations on
    // val constructor parameters (in future parameter AND property). For Dagger/Hilt
    // the parameter counts; the use-site target makes that unambiguous.
    @param:SseClient private val client: OkHttpClient,
    private val json: Json
) : CsvImportStream {
    sealed class Event {
        /** Status change from the server (incl. idle state when no import runs). */
        data class Status(val status: CsvImportStatusView) : Event()
        /**
         * Connection error. [technical] is exclusively for the log: the caller
         * (CsvImportService via followStream) falls back to polling, the user is
         * shown nothing — hence no translatable
         * text but the cause in technical form.
         */
        data class Failed(val technical: String?) : Event()
    }

    /**
     * Opens a persistent SSE connection and emits every status
     * the server sends. Closes only on a connection error.
     * Cold flow — the connection is established on collect, closed on cancel.
     */
    override fun stream(): Flow<Event> = flow {
        // Address and token are set by the client's guard as for every fetch; without
        // sign-in the server answers 401, and the caller asks again later.
        val request = Request.Builder()
            .url("${PLACEHOLDER_BASE}api/v1/sets/import/csv/stream")
            .header("Accept", "text/event-stream")
            .build()

        // Do NOT close the connection as long as statuses come — leave it open for the next import.
        // Every other end (also an unreadable event) means Failed: the caller
        // reconnects or polls instead of waiting for a status that never comes.
        val events = sseStream(client, request) { json.decodeFromString(CsvImportStatus.serializer(), it) }
        emitAll(events.map { e ->
            when (e) {
                is SseEvent.Data      -> Event.Status(e.value.asView())
                is SseEvent.Unreadable   -> Event.Failed("unreadable event: ${e.technical}")
                is SseEvent.Ended    -> Event.Failed("stream closed by server")
                is SseEvent.StreamFailed -> Event.Failed(e.code?.let { "HTTP $it" } ?: e.technical)
            }
        })
    }
}
