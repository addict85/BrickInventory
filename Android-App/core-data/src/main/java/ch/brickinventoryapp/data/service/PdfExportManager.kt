package ch.brickinventoryapp.data.service

import ch.brickinventoryapp.data.di.SseClient
import ch.brickinventoryapp.model.util.fangeAusserAbbruch
import android.content.Context
import ch.brickinventoryapp.data.SseEreignis
import ch.brickinventoryapp.data.Zugangsdaten
import ch.brickinventoryapp.data.sseStrom
import ch.brickinventoryapp.data.repository.SetsRepository
import ch.brickinventoryapp.data.repository.Ergebnis
import ch.brickinventoryapp.data.util.Teilelistentresor
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.delay
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.launch
import kotlinx.coroutines.isActive
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.takeWhile
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import okhttp3.OkHttpClient
import okhttp3.Request
import java.io.File
import javax.inject.Inject
import javax.inject.Singleton
import ch.brickinventoryapp.netz.data.api.Fehlerrumpf
import ch.brickinventoryapp.data.repository.fehlerTextZuCode
import ch.brickinventoryapp.data.util.LanguageManager
import ch.brickinventoryapp.netz.util.Protokoll
import ch.brickinventoryapp.ressourcen.R

sealed class PdfExportState {
    data object Idle : PdfExportState()
    data class Running(val statusText: String) : PdfExportState()
    data class Done(val file: File) : PdfExportState()
    data class Error(val message: String) : PdfExportState()
}

/**
 * Steuert den PDF-Export: Job starten → per SSE auf Abschluss warten →
 * PDF herunterladen. SSE ersetzt den früheren 3s-Poll: das Ergebnis kommt
 * sofort wenn der Server fertig ist. Polling als Fallback falls SSE scheitert.
 */
@Singleton
class PdfExportManager @Inject constructor(
    private val sets: SetsRepository,
    private val prefs: Zugangsdaten,
    @param:SseClient private val sseClient: OkHttpClient,
    private val json: Json,
    private val teilelistentresor: Teilelistentresor,
    @param:ApplicationContext private val context: Context
) {
    private val _state = MutableStateFlow<PdfExportState>(PdfExportState.Idle)
    val state = _state.asStateFlow()

    // Statustexte in der gewählten App-Sprache (nicht Systemsprache):
    // der ApplicationContext kennt die per-App-Sprache unterhalb von
    // Android 13 nicht — siehe LanguageManager.localizedContext().
    private fun s(id: Int, vararg args: Any): String =
        LanguageManager.localizedContext(context).getString(id, *args)

    @Volatile var pendingBody: String? = null

    // Zeitpunkt (ms), zu dem das PDF laut Server-Schätzung fertig sein sollte.
    // 0 = noch unbekannt (etaSeconds vom Server noch nicht erhalten).
    @Volatile private var etaDeadlineMs: Long = 0L

    // true nur, solange der Server-Status "running" ist (PDF wird gerade erstellt).
    // Der Countdown wird ausschliesslich in diesem Zustand angezeigt.
    @Volatile private var jobRunning: Boolean = false

    private fun setEtaOnce(etaSeconds: Int?) {
        if (etaDeadlineMs == 0L && etaSeconds != null && etaSeconds > 0) {
            etaDeadlineMs = System.currentTimeMillis() + etaSeconds * 1000L
        }
    }

    fun reset() { _state.value = PdfExportState.Idle }

    /** Fünf Versuche mit wachsender Pause: Das fertige PDF liegt manchmal erst kurz nach der Meldung bereit. */
    private suspend fun ladePdf(jobId: String): Ergebnis<ByteArray>? {
        var downloadResult: Ergebnis<ByteArray>? = null
        var dlDelay = 2000L
        repeat(5) { attempt ->
            if (downloadResult !is Ergebnis.Success) {
                if (attempt > 0) { delay(dlDelay); dlDelay = minOf(dlDelay * 2, 30_000L) }
                downloadResult = sets.downloadPdf(jobId)
            }
        }
        return downloadResult
    }

    /** Wird vom PdfExportService aufgerufen. */
    suspend fun run() {
        val body = pendingBody ?: run {
            _state.value = PdfExportState.Error(s(R.string.pdfexp_no_data))
            return
        }
        pendingBody = null
        _state.value = PdfExportState.Running(s(R.string.pdfexp_starting))

        fangeAusserAbbruch {
            // Step 1: Job starten
            val jobId = when (val r = sets.startPdfJob(body)) {
                is Ergebnis.Success -> r.data
                is Ergebnis.Error   -> { _state.value = PdfExportState.Error(r.message); return }
            }

            _state.value = PdfExportState.Running(s(R.string.pdfexp_loading_images))
            etaDeadlineMs = 0L
            jobRunning = false

            // Step 2: Per SSE auf Abschluss warten — parallel ein Ticker, der aus der
            // Server-Schätzung (etaSeconds ≈ Anzahl fehlender Bilder, ~1/s Download)
            // jede Sekunde die verbleibende Wartezeit anzeigt — aber NUR, solange der
            // Server-Status "running" ist (also während die PDF erstellt wird).
            val baseUrl = prefs.serverUrlJetzt().trim().trimEnd('/')
            val token   = prefs.tokenJetzt()
            val done = coroutineScope {
                val ticker = launch {
                    while (isActive) {
                        delay(1000)
                        if (jobRunning && etaDeadlineMs > 0L) {
                            val remaining = ((etaDeadlineMs - System.currentTimeMillis() + 999) / 1000L).toInt()
                            _state.value = PdfExportState.Running(
                                if (remaining > 0) s(R.string.pdfexp_creating_eta, remaining)
                                else s(R.string.pdfexp_almost_done)
                            )
                        }
                    }
                }
                try { waitForPdfJob(baseUrl, token, jobId) } finally { ticker.cancel() }
            }
            if (!done) {
                if (_state.value !is PdfExportState.Error)
                    _state.value = PdfExportState.Error(s(R.string.pdfexp_server_error))
                return
            }

            // Step 3: PDF herunterladen
            _state.value = PdfExportState.Running(s(R.string.pdfexp_downloading))
            when (val r = ladePdf(jobId)) {
                is Ergebnis.Success -> {
                    val file = teilelistentresor.lege(context.filesDir, context.getExternalFilesDir(null), r.data)
                    // Auch verschlüsselt bleibt das Inventar nur, solange jemand es öffnen will.
                    runCatching { TeilelistenAufraeumer.plane(context) }
                    _state.value = PdfExportState.Done(file)
                }
                is Ergebnis.Error -> _state.value = PdfExportState.Error(r.message)
                // downloadResult ist als Ergebnis<ByteArray>? deklariert, damit die
                // Wiederholschleife oben es überschreiben kann.
                // Ausführlich: docs/begruendungen/core-data/data/service/PdfExportManager.kt.md#z146
                null -> _state.value =
                    PdfExportState.Error(s(R.string.pdfexp_unknown_error))
            }
        }.onFailure { e ->
            _state.value = PdfExportState.Error(e.message ?: s(R.string.pdfexp_unknown_error))
        }
    }

    /**
     * Wartet via SSE auf done/error des PDF-Jobs. Fällt bei SSE-Fehler
     * transparent auf 3s-Polling zurück. Gibt true zurück wenn done.
     * Die gesamte Logik läuft als suspend-Funktion im aufrufenden Coroutine-
     * Scope (PdfExportService) — kein GlobalScope nötig.
     */
    private suspend fun waitForPdfJob(baseUrl: String, token: String, jobId: String): Boolean {
        // Attempt 1: SSE
        val sseResult = tryWaitViaSse(baseUrl, token, jobId)
        if (sseResult != null) return sseResult

        // SSE nicht verfügbar → Polling-Fallback
        return pollUntilDone(jobId)
    }

    /**
     * Versucht per SSE zu warten. Gibt null zurück, wenn SSE fehlschlug (Fallback nötig).
     * Auch ein unlesbares Ereignis heisst null: Das Polling fragt den Stand selbst ab,
     * statt dass der Export auf ein Abschlussereignis wartet, das nie lesbar ankommt.
     */
    private suspend fun tryWaitViaSse(baseUrl: String, token: String, jobId: String): Boolean? {
        val request = Request.Builder()
            .url("$baseUrl/api/v1/sets/partslist-pdf/stream/$jobId")
            .header("Authorization", "Bearer $token")
            .header("Accept", "text/event-stream")
            .build()

        var ergebnis: Boolean? = null
        sseStrom(sseClient, request) { liesPdfJobMeldung(json, it) }.takeWhile { e ->
            when (e) {
                is SseEreignis.Daten -> {
                    setEtaOnce(e.wert.etaSeconds)
                    ergebnis = wendeAn(e.wert)
                    ergebnis == null
                }
                is SseEreignis.Unlesbar -> {
                    Protokoll.warnung("PdfExport", "Unlesbares SSE-Ereignis: ${e.technisch}")
                    false
                }
                is SseEreignis.Beendet -> false
                is SseEreignis.Gescheitert -> {
                    ergebnis = fehlerAusHttp(e)
                    false
                }
            }
        }.collect { }
        return ergebnis
    }

    /** true = fertig, false = Fehler (Zustand gesetzt), null = läuft noch. */
    private fun wendeAn(m: PdfJobMeldung): Boolean? = when (m.status) {
        "done" -> {
            jobRunning = false
            _state.value = PdfExportState.Running(s(R.string.pdfexp_finalizing))
            true
        }
        "error" -> {
            jobRunning = false
            _state.value = PdfExportState.Error(m.fehler ?: s(R.string.pdfexp_server_error))
            false
        }
        "running" -> { jobRunning = true; null }  // Countdown-Anzeige übernimmt der Ticker.
        else -> null
    }

    /** 404 = Endpoint nicht vorhanden → null (Fallback); andere Fehler = echter Fehler (false). */
    private fun fehlerAusHttp(e: SseEreignis.Gescheitert): Boolean? {
        val code = e.code
        if (code == null || code == 404 || code == 0) return null
        // 429 `zu_viele_verbindungen`: Der Rat steht im Code, nicht im Status.
        val fehlercode = runCatching { Fehlerrumpf.lies(e.rumpf).fehlercode }.getOrNull()
        _state.value = PdfExportState.Error(fehlerTextZuCode(fehlercode)?.let { s(it) }
            ?: s(R.string.pdfexp_http_error, code))
        return false
    }

    /** 3s-Polling-Fallback wenn SSE nicht verfügbar. */
    private suspend fun pollUntilDone(jobId: String): Boolean {
        var errors = 0
        val deadline = System.currentTimeMillis() + 10 * 60 * 1000L
        while (System.currentTimeMillis() < deadline) {
            delay(3000)
            when (val r = sets.getPdfJobStatus(jobId)) {
                is Ergebnis.Success -> {
                    errors = 0
                    setEtaOnce(r.data.etaSeconds)
                    when (r.data.status) {
                        "done"    -> { jobRunning = false; return true }
                        "error"   -> { jobRunning = false; return false }
                        "running" -> jobRunning = true  // Countdown-Anzeige übernimmt der Ticker.
                    }
                }
                is Ergebnis.Error -> { errors++; if (errors >= 10) return false }
            }
        }
        return false
    }
}

/** Eine Meldung des Job-Stroms; die Felder fehlen, wenn der Server sie nicht schickt. */
private data class PdfJobMeldung(val status: String?, val etaSeconds: Int?, val fehler: String?)

private fun liesPdfJobMeldung(json: Json, text: String): PdfJobMeldung {
    val obj = json.parseToJsonElement(text).jsonObject
    return PdfJobMeldung(
        status = obj["status"]?.jsonPrimitive?.content,
        etaSeconds = obj["etaSeconds"]?.jsonPrimitive?.content?.toIntOrNull(),
        fehler = obj["error"]?.jsonPrimitive?.content,
    )
}
