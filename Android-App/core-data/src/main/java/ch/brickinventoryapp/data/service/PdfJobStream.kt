package ch.brickinventoryapp.data.service

import ch.brickinventoryapp.data.SseEvent
import ch.brickinventoryapp.data.di.SseClient
import ch.brickinventoryapp.data.repository.Ergebnis
import ch.brickinventoryapp.data.sseStream
import ch.brickinventoryapp.contract.PdfAuftragStand
import ch.brickinventoryapp.model.domain.PdfJobStatus
import ch.brickinventoryapp.data.repository.asStatus
import ch.brickinventoryapp.network.data.api.Fehlerrumpf
import ch.brickinventoryapp.network.di.PLACEHOLDER_BASE
import ch.brickinventoryapp.network.util.Protokoll
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
 * state ends as [Ereignis.Weg]; then the caller queries itself.
 */
@Singleton
class PdfJobStream @Inject internal constructor(
    @param:SseClient private val client: OkHttpClient,
    private val json: Json,
) {
    sealed interface Ereignis {
        data class Stand(val stand: PdfJobStatus) : Ereignis

        /** No stream: old server (404), break, end or an unreadable event. */
        data object Weg : Ereignis

        /** The server rejects the stream; [fehler] as for every fetch, with its sentence and code. */
        data class Rejected(val fehler: Ergebnis.Fehler) : Ereignis
    }

    fun observe(jobId: String): Flow<Ereignis> {
        val anfrage = Request.Builder()
            .url("${PLACEHOLDER_BASE}api/v1/sets/partslist-pdf/stream/$jobId")
            .header("Accept", "text/event-stream")
            .build()
        return sseStream(client, anfrage) { json.decodeFromString(PdfAuftragStand.serializer(), it) }.map { e ->
            when (e) {
                is SseEvent.Daten -> Ereignis.Stand(e.wert.asStatus())
                is SseEvent.Unlesbar -> {
                    Protokoll.warnung("PdfExport", "Unlesbares SSE-Ereignis: ${e.technical}")
                    Ereignis.Weg
                }
                is SseEvent.Ended -> Ereignis.Weg
                is SseEvent.Gescheitert -> abgelehnt(e)?.let(Ereignis::Rejected) ?: Ereignis.Weg
            }
        }
    }

    /** Without a response or with 404 there is no stream; every other status is a refusal. */
    private fun abgelehnt(e: SseEvent.Gescheitert): Ergebnis.Fehler? {
        val code = e.code
        if (code == null || code == 0 || code == HTTP_NOT_FOUND) return null
        val rumpf = Fehlerrumpf.lies(e.rumpf)
        return if (code == HTTP_REJECTED) Ergebnis.Fehler.Abgewiesen(rumpf.text.orEmpty(), rumpf.errorCode)
        else Ergebnis.Fehler.Server(code, rumpf.text.orEmpty(), rumpf.errorCode)
    }

    private companion object {
        const val HTTP_NOT_FOUND = 404
        const val HTTP_REJECTED = 401
    }
}
