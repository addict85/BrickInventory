package ch.brickinventoryapp.services.service

import android.content.Context
import ch.brickinventoryapp.data.di.Scopes
import ch.brickinventoryapp.data.repository.Ergebnis
import ch.brickinventoryapp.data.repository.SetDateienRepository
import ch.brickinventoryapp.model.domain.Teilelistenauftrag
import ch.brickinventoryapp.data.service.PdfJobStream
import ch.brickinventoryapp.data.service.PdfFailure
import ch.brickinventoryapp.data.util.Teilelistentresor
import ch.brickinventoryapp.model.domain.PdfJobStatus
import ch.brickinventoryapp.model.domain.Laufstatus
import ch.brickinventoryapp.model.domain.PdfProgress
import ch.brickinventoryapp.model.domain.PdfStep
import ch.brickinventoryapp.model.util.fangeAusserAbbruch
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.Job
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.takeWhile
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import java.io.File
import javax.inject.Inject
import javax.inject.Singleton
import kotlin.math.roundToLong

/** Where the export stands, as field values; the records form parts list and service. */
internal sealed interface PdfExportState {
    data object Idle : PdfExportState
    data class Running(val fortschritt: PdfProgress) : PdfExportState
    data class Done(val file: File) : PdfExportState
    data class Error(val grund: PdfFailure) : PdfExportState
}

/**
 * Controls the PDF export: start the job, wait for completion via SSE (polling
 * as a fallback), download the PDF. The job runs in the application scope, so
 * it survives the screen; the foreground service only keeps the process awake while it does.
 */
@Singleton
internal class PdfExportManager @Inject constructor(
    private val dateien: SetDateienRepository,
    private val strom: PdfJobStream,
    private val teilelistentresor: Teilelistentresor,
    private val areas: Scopes,
    @param:ApplicationContext private val context: Context,
) {
    private val _state = MutableStateFlow<PdfExportState>(PdfExportState.Idle)
    val state = _state.asStateFlow()

    private var job: Job? = null

    /** A new job replaces a running one; the state immediately switches to „starting“. */
    fun commission(anfrage: Teilelistenauftrag) {
        job?.cancel()
        _state.value = PdfExportState.Running(PdfProgress(PdfStep.STARTET))
        job = areas.application.launch(areas.io) { runFrom(anfrage) }
    }

    /** Five attempts with a growing pause: the finished PDF is sometimes only ready shortly after the notification. */
    private suspend fun loadPdf(jobId: String): Ergebnis<ByteArray> {
        var ergebnis: Ergebnis<ByteArray> = dateien.downloadPdf(jobId)
        var pause = 2000L
        repeat(4) {
            if (ergebnis is Ergebnis.Erfolg) return ergebnis
            delay(pause); pause = minOf(pause * 2, 30_000L)
            ergebnis = dateien.downloadPdf(jobId)
        }
        return ergebnis
    }

    suspend fun runFrom(anfrage: Teilelistenauftrag) {
        fangeAusserAbbruch {
            val jobId = when (val r = dateien.startPdfJob(anfrage)) {
                is Ergebnis.Erfolg -> r.data
                is Ergebnis.Fehler -> { fail(PdfFailure.Abruf(r)); return }
            }
            _state.value = PdfExportState.Running(PdfProgress(PdfStep.IMAGES_LOAD))
            val lauf = Lauf()
            // Alongside the waiting, a ticker: from the server's estimate (etaSeconds ≈
            // missing images), the remaining time every second, but only while it's still being created.
            val grund = coroutineScope {
                val ticker = launch {
                    while (isActive) {
                        delay(1000)
                        val deadline = lauf.deadlineMs
                        if (lauf.erstellt && deadline > 0L) {
                            val rest = ((deadline - System.currentTimeMillis() + 999) / 1000L).toInt()
                            _state.value = PdfExportState.Running(PdfProgress(PdfStep.CREATED, rest))
                        }
                    }
                }
                try { waitOnJob(jobId, lauf) } finally { ticker.cancel() }
            }
            if (grund != null) { fail(grund); return }

            _state.value = PdfExportState.Running(PdfProgress(PdfStep.DOWNLOAD))
            when (val r = loadPdf(jobId)) {
                is Ergebnis.Erfolg -> {
                    val file = teilelistentresor.put(context.filesDir, context.getExternalFilesDir(null), r.data)
                    // Even encrypted, the inventory only stays as long as someone wants to open it.
                    runCatching { PartListsAufraeumer.plane(context) }
                    _state.value = PdfExportState.Done(file)
                }
                is Ergebnis.Fehler -> fail(PdfFailure.Abruf(r))
            }
        }.onFailure { e -> fail(PdfFailure.Abruf(Ergebnis.Fehler.Unbekannt(technical = e.message))) }
    }

    private fun fail(grund: PdfFailure) { _state.value = PdfExportState.Error(grund) }

    /** Waits for completion via SSE, otherwise via polling. Null means done, otherwise the reason. */
    private suspend fun waitOnJob(jobId: String, lauf: Lauf): PdfFailure? {
        var ausgang: Ausgang? = null
        strom.observe(jobId).takeWhile { e ->
            when (e) {
                is PdfJobStream.Ereignis.Stand -> { ausgang = applyAn(e.stand, lauf); ausgang == null }
                PdfJobStream.Ereignis.Weg -> false
                is PdfJobStream.Ereignis.Rejected -> { ausgang = Ausgang(PdfFailure.Abruf(e.fehler)); false }
            }
        }.collect { }
        return (ausgang ?: questionAbUntilDone(jobId, lauf)).grund
    }

    /** Null: still running. */
    private fun applyAn(stand: PdfJobStatus, lauf: Lauf): Ausgang? {
        lauf.rememberDeadline(stand.restSeconds)
        return when (stand.status) {
            Laufstatus.FERTIG -> {
                lauf.erstellt = false
                _state.value = PdfExportState.Running(PdfProgress(PdfStep.COMPLETION))
                Ausgang(null)
            }
            Laufstatus.FEHLER -> { lauf.erstellt = false; Ausgang(PdfFailure.Auftrag(stand.fehler)) }
            Laufstatus.LAEUFT -> { lauf.erstellt = true; null }
            Laufstatus.RUHT, Laufstatus.WARTET, Laufstatus.ABGEBROCHEN, Laufstatus.UNBEKANNT -> null
        }
    }

    /** Fallback without a stream: query every 3s, at most ten minutes, at most ten errors in a row. */
    private suspend fun questionAbUntilDone(jobId: String, lauf: Lauf): Ausgang {
        var fehler = 0
        val bis = System.currentTimeMillis() + 10 * 60 * 1000L
        var zuletzt: Ergebnis.Fehler = Ergebnis.Fehler.Zeitueberschreitung
        while (System.currentTimeMillis() < bis) {
            delay(3000)
            when (val r = dateien.getPdfJobStatus(jobId)) {
                is Ergebnis.Erfolg -> { fehler = 0; applyAn(r.data, lauf)?.let { return it } }
                is Ergebnis.Fehler -> { zuletzt = r; if (++fehler >= 10) return Ausgang(PdfFailure.Abruf(r)) }
            }
        }
        return Ausgang(PdfFailure.Abruf(zuletzt))
    }

    /** How a job ended: [grund] null means done. */
    private class Ausgang(val grund: PdfFailure?)

    /** What a single job knows about its own time; new for each job. */
    private class Lauf {
        /** When the PDF will be done according to the first estimate, 0 without an estimate. */
        @Volatile var deadlineMs = 0L

        /** Only while the server is still creating it does the ticker show a remaining time. */
        @Volatile var erstellt = false

        fun rememberDeadline(seconds: Double?) {
            if (deadlineMs == 0L && seconds != null && seconds > 0) deadlineMs = System.currentTimeMillis() + (seconds * 1000).roundToLong()
        }
    }
}
