package ch.brickinventoryapp.data.service

import ch.brickinventoryapp.data.SseEreignis
import ch.brickinventoryapp.data.di.SseClient
import ch.brickinventoryapp.data.repository.Ergebnis
import ch.brickinventoryapp.data.sseStrom
import ch.brickinventoryapp.model.data.model.PdfAuftragStand
import ch.brickinventoryapp.netz.data.api.Fehlerrumpf
import ch.brickinventoryapp.netz.di.PLATZHALTER_BASIS
import ch.brickinventoryapp.netz.util.Protokoll
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
class PdfAuftragsStrom @Inject internal constructor(
    @param:SseClient private val client: OkHttpClient,
    private val json: Json,
) {
    sealed interface Ereignis {
        data class Stand(val stand: PdfAuftragStand) : Ereignis

        /** Kein Strom: alter Server (404), Abriss, Ende oder ein unlesbares Ereignis. */
        data object Weg : Ereignis

        /** Der Server weist den Strom ab; [fehler] wie bei jedem Abruf, mit seinem Satz und Code. */
        data class Abgelehnt(val fehler: Ergebnis.Error) : Ereignis
    }

    fun beobachte(jobId: String): Flow<Ereignis> {
        val anfrage = Request.Builder()
            .url("${PLATZHALTER_BASIS}api/v1/sets/partslist-pdf/stream/$jobId")
            .header("Accept", "text/event-stream")
            .build()
        return sseStrom(client, anfrage) { json.decodeFromString(PdfAuftragStand.serializer(), it) }.map { e ->
            when (e) {
                is SseEreignis.Daten -> Ereignis.Stand(e.wert)
                is SseEreignis.Unlesbar -> {
                    Protokoll.warnung("PdfExport", "Unlesbares SSE-Ereignis: ${e.technisch}")
                    Ereignis.Weg
                }
                is SseEreignis.Beendet -> Ereignis.Weg
                is SseEreignis.Gescheitert -> abgelehnt(e)?.let(Ereignis::Abgelehnt) ?: Ereignis.Weg
            }
        }
    }

    /** Ohne Antwort oder mit 404 gibt es keinen Strom; jeder andere Status ist eine Absage. */
    private fun abgelehnt(e: SseEreignis.Gescheitert): Ergebnis.Error? {
        val code = e.code
        if (code == null || code == 0 || code == HTTP_NICHT_GEFUNDEN) return null
        val rumpf = Fehlerrumpf.lies(e.rumpf)
        return if (code == HTTP_ABGEWIESEN) Ergebnis.Error.Abgewiesen(rumpf.text.orEmpty(), rumpf.fehlercode)
        else Ergebnis.Error.Server(code, rumpf.text.orEmpty(), rumpf.fehlercode)
    }

    private companion object {
        const val HTTP_NICHT_GEFUNDEN = 404
        const val HTTP_ABGEWIESEN = 401
    }
}
