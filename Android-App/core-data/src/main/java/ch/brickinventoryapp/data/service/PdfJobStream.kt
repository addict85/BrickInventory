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
 * Die Ereignisse eines PDF-Auftrags über den SSE-Client: Adresse und Token setzt dessen
 * Wächter wie bei jedem Abruf, gelesen wird das Modell der Statusabfrage. Was keinen
 * Stand liefert, endet als [Ereignis.Weg]; dann fragt der Aufrufer selbst ab.
 */
@Singleton
class PdfJobStream @Inject internal constructor(
    @param:SseClient private val client: OkHttpClient,
    private val json: Json,
) {
    sealed interface Ereignis {
        data class Stand(val stand: PdfJobStatus) : Ereignis

        /** Kein Strom: alter Server (404), Abriss, Ende oder ein unlesbares Ereignis. */
        data object Weg : Ereignis

        /** Der Server weist den Strom ab; [fehler] wie bei jedem Abruf, mit seinem Satz und Code. */
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

    /** Ohne Antwort oder mit 404 gibt es keinen Strom; jeder andere Status ist eine Absage. */
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
