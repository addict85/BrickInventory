package ch.brickinventoryapp.service

import android.content.Context
import ch.brickinventoryapp.data.PreferencesManager
import ch.brickinventoryapp.data.repository.BrickRepository
import ch.brickinventoryapp.data.repository.Result
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.delay
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.launch
import kotlinx.coroutines.isActive
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okhttp3.sse.EventSource
import okhttp3.sse.EventSourceListener
import okhttp3.sse.EventSources
import java.io.File
import java.util.concurrent.atomic.AtomicBoolean
import javax.inject.Inject
import javax.inject.Named
import javax.inject.Singleton
import kotlin.coroutines.resume

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
    private val repo: BrickRepository,
    private val prefs: PreferencesManager,
    @param:Named("sse") private val sseClient: OkHttpClient,
    private val json: Json,
    @param:ApplicationContext private val context: Context
) {
    private val _state = MutableStateFlow<PdfExportState>(PdfExportState.Idle)
    val state = _state.asStateFlow()

    // Statustexte in der gewählten App-Sprache (nicht Systemsprache):
    // der ApplicationContext kennt die per-App-Sprache unterhalb von
    // Android 13 nicht — siehe LanguageManager.localizedContext().
    private fun s(id: Int, vararg args: Any): String =
        ch.brickinventoryapp.util.LanguageManager.localizedContext(context).getString(id, *args)

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

    /** Wird vom PdfExportService aufgerufen. */
    suspend fun run() {
        val body = pendingBody ?: run {
            _state.value = PdfExportState.Error(s(ch.brickinventoryapp.R.string.pdfexp_no_data))
            return
        }
        pendingBody = null
        _state.value = PdfExportState.Running(s(ch.brickinventoryapp.R.string.pdfexp_starting))

        try {
            // Step 1: Job starten
            val jobId = when (val r = repo.startPdfJob(body)) {
                is Result.Success -> r.data
                is Result.Error   -> { _state.value = PdfExportState.Error(r.message); return }
            }

            _state.value = PdfExportState.Running(s(ch.brickinventoryapp.R.string.pdfexp_loading_images))
            etaDeadlineMs = 0L
            jobRunning = false

            // Step 2: Per SSE auf Abschluss warten — parallel ein Ticker, der aus der
            // Server-Schätzung (etaSeconds ≈ Anzahl fehlender Bilder, ~1/s Download)
            // jede Sekunde die verbleibende Wartezeit anzeigt — aber NUR, solange der
            // Server-Status "running" ist (also während die PDF erstellt wird).
            val baseUrl = prefs.serverUrl.first().trim().trimEnd('/')
            val token   = prefs.authToken.first()
            val done = coroutineScope {
                val ticker = launch {
                    while (isActive) {
                        delay(1000)
                        if (jobRunning && etaDeadlineMs > 0L) {
                            val remaining = ((etaDeadlineMs - System.currentTimeMillis() + 999) / 1000L).toInt()
                            _state.value = PdfExportState.Running(
                                if (remaining > 0) s(ch.brickinventoryapp.R.string.pdfexp_creating_eta, remaining)
                                else s(ch.brickinventoryapp.R.string.pdfexp_almost_done)
                            )
                        }
                    }
                }
                try { waitForPdfJob(baseUrl, token, jobId) } finally { ticker.cancel() }
            }
            if (!done) {
                if (_state.value !is PdfExportState.Error)
                    _state.value = PdfExportState.Error("PDF-Fehler auf dem Server")
                return
            }

            // Step 3: PDF herunterladen
            _state.value = PdfExportState.Running(s(ch.brickinventoryapp.R.string.pdfexp_downloading))
            var downloadResult: Result<ByteArray>? = null
            var dlDelay = 2000L
            repeat(5) { attempt ->
                if (downloadResult !is Result.Success) {
                    if (attempt > 0) { delay(dlDelay); dlDelay = minOf(dlDelay * 2, 30_000L) }
                    downloadResult = repo.downloadPdf(jobId)
                }
            }
            when (val r = downloadResult) {
                is Result.Success -> {
                    // Unterverzeichnis pdf/: file_paths.xml grenzt den
                    // FileProvider auf genau dieses Verzeichnis ein — vorher
                    // waren die kompletten files-/cache-Wurzeln (inkl. des
                    // API-Caches mit dem Inventar) über die Provider-Authority
                    // freigegeben.
                    val dir  = File(context.getExternalFilesDir(null) ?: context.filesDir, "pdf")
                        .apply { mkdirs() }
                    val file = File(dir, "teileliste.pdf")
                    file.outputStream().use { it.write(r.data) }
                    _state.value = PdfExportState.Done(file)
                }
                is Result.Error -> _state.value = PdfExportState.Error(r.message)
                // downloadResult ist als Result<ByteArray>? deklariert, damit die
                // Wiederholschleife oben es überschreiben kann. Dass die Schleife
                // IMMER mindestens einmal zuweist (repeat(5) läuft, und beim
                // ersten Durchlauf ist der Wert null, also nicht Success), kann
                // der Compiler nicht sehen — Zuweisungen in einer Lambda zählen
                // für ihn nicht als sichere Initialisierung.
                //
                // Bewusst ein null-Zweig und KEIN else: BrickRepository.kt sagt
                // ausdrücklich, dass jedes when über Result erschöpfend bleiben
                // soll, damit ein künftiger dritter Zustand überall auffällt.
                // Ein else würde genau das verdecken.
                //
                // Ohne diesen Zweig bliebe die Oberfläche im Zustand "Running"
                // hängen, falls der Fall doch je einträte.
                null -> _state.value =
                    PdfExportState.Error(s(ch.brickinventoryapp.R.string.pdfexp_unknown_error))
            }
        } catch (e: Exception) {
            _state.value = PdfExportState.Error(e.message ?: s(ch.brickinventoryapp.R.string.pdfexp_unknown_error))
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

    /** Versucht per SSE zu warten. Gibt null zurück, wenn SSE fehlschlug (Fallback nötig). */
    private suspend fun tryWaitViaSse(
        baseUrl: String, token: String, jobId: String
    ): Boolean? = suspendCancellableCoroutine { cont ->
        val settled = AtomicBoolean(false)
        fun settle(value: Boolean?) {
            if (settled.compareAndSet(false, true)) cont.resume(value)
        }

        val request = Request.Builder()
            .url("$baseUrl/api/v1/sets/partslist-pdf/stream/$jobId")
            .header("Authorization", "Bearer $token")
            .header("Accept", "text/event-stream")
            .build()

        val es = EventSources.createFactory(sseClient).newEventSource(request,
            object : EventSourceListener() {
                override fun onEvent(eventSource: EventSource, id: String?, type: String?, data: String) {
                    if (data.isBlank()) return
                    try {
                        val obj = json.parseToJsonElement(data).jsonObject
                        setEtaOnce(obj["etaSeconds"]?.jsonPrimitive?.content?.toIntOrNull())
                        when (obj["status"]?.jsonPrimitive?.content) {
                            "done"    -> { jobRunning = false; _state.value = PdfExportState.Running(s(ch.brickinventoryapp.R.string.pdfexp_finalizing)); settle(true) }
                            "error"   -> { jobRunning = false; _state.value = PdfExportState.Error(
                                obj["error"]?.jsonPrimitive?.content ?: "PDF-Fehler"); settle(false) }
                            "running" -> jobRunning = true  // Countdown-Anzeige übernimmt der Ticker.
                        }
                    } catch (_: Exception) {}
                }
                // Stream sauber geschlossen ohne Ergebnis → Fallback
                override fun onClosed(eventSource: EventSource) { settle(null) }
                override fun onFailure(eventSource: EventSource, t: Throwable?, response: Response?) {
                    // 404 = Endpoint nicht vorhanden → Fallback; andere Fehler = echter Fehler
                    if (response != null && response.code != 404 && response.code != 0) {
                        _state.value = PdfExportState.Error("HTTP ${response.code}")
                        settle(false)
                    } else {
                        settle(null) // Fallback auf Polling
                    }
                }
            })
        cont.invokeOnCancellation { es.cancel() }
    }

    /** 3s-Polling-Fallback wenn SSE nicht verfügbar. */
    private suspend fun pollUntilDone(jobId: String): Boolean {
        var errors = 0
        val deadline = System.currentTimeMillis() + 10 * 60 * 1000L
        while (System.currentTimeMillis() < deadline) {
            delay(3000)
            when (val r = repo.getPdfJobStatus(jobId)) {
                is Result.Success -> {
                    errors = 0
                    setEtaOnce(r.data.etaSeconds)
                    when (r.data.status) {
                        "done"    -> { jobRunning = false; return true }
                        "error"   -> { jobRunning = false; return false }
                        "running" -> jobRunning = true  // Countdown-Anzeige übernimmt der Ticker.
                    }
                }
                is Result.Error -> { errors++; if (errors >= 10) return false }
            }
        }
        return false
    }
}
