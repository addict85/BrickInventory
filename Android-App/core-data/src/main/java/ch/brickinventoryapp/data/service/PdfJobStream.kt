package ch.brickinventoryapp.data.service

import ch.brickinventoryapp.contract.PdfAuftragStand
import ch.brickinventoryapp.data.SseEvent
import ch.brickinventoryapp.data.di.SseClient
import ch.brickinventoryapp.data.repository.Outcome
import ch.brickinventoryapp.data.repository.asStatus
import ch.brickinventoryapp.data.sseStream
import ch.brickinventoryapp.model.domain.PdfJobStatus
import ch.brickinventoryapp.network.data.api.ErrorBody
import ch.brickinventoryapp.network.di.PLACEHOLDER_BASE
import ch.brickinventoryapp.network.util.AppLog
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map
import kotlinx.serialization.json.Json
import okhttp3.OkHttpClient
import okhttp3.Request
import javax.inject.Inject
import javax.inject.Singleton

/**
 * The events of a PDF job via the SSE client: its guard sets address and token
 * as for every fetch, the status query's model is read. What delivers no
 * state ends as [Event.Gone]; then the caller queries itself.
 */
@Singleton
class PdfJobStream @Inject internal constructor(
    @param:SseClient private val client: OkHttpClient,
    private val json: Json,
) {
    sealed interface Event {
        data class State(val state: PdfJobStatus) : Event

        /** No stream: old server (404), break, end or an unreadable event. */
        data object Gone : Event

        /** The server rejects the stream; [error] as for every fetch, with its sentence and code. */
        data class Rejected(val error: Outcome.Failure) : Event
    }

    fun observe(jobId: String): Flow<Event> {
        val request = Request.Builder()
            .url("${PLACEHOLDER_BASE}api/v1/sets/partslist-pdf/stream/$jobId")
            .header("Accept", "text/event-stream")
            .build()
        return sseStream(client, request) { json.decodeFromString(PdfAuftragStand.serializer(), it) }.map { e ->
            when (e) {
                is SseEvent.Data -> Event.State(e.value.asStatus())
                is SseEvent.Unreadable -> {
                    AppLog.warning("PdfExport", "Unlesbares SSE-Ereignis: ${e.technical}")
                    Event.Gone
                }
                is SseEvent.Ended -> Event.Gone
                is SseEvent.StreamFailed -> declined(e)?.let(Event::Rejected) ?: Event.Gone
            }
        }
    }

    /** Without a response or with 404 there is no stream; every other status is a refusal. */
    private fun declined(e: SseEvent.StreamFailed): Outcome.Failure? {
        val code = e.code
        if (code == null || code == 0 || code == HTTP_NOT_FOUND) return null
        val body = ErrorBody.read(e.body)
        return if (code == HTTP_REJECTED) Outcome.Failure.Rejected(body.text.orEmpty(), body.errorCode)
        else Outcome.Failure.Server(code, body.text.orEmpty(), body.errorCode)
    }

    private companion object {
        const val HTTP_NOT_FOUND = 404
        const val HTTP_REJECTED = 401
    }
}
