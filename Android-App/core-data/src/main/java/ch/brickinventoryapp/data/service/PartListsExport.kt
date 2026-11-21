package ch.brickinventoryapp.data.service

import ch.brickinventoryapp.model.domain.Teilelistenauftrag
import ch.brickinventoryapp.data.repository.Ergebnis
import ch.brickinventoryapp.model.domain.PdfProgress
import kotlinx.coroutines.flow.Flow
import java.io.File

/** Why a PDF export failed; the UI forms the sentence. */
sealed interface PdfFailure {
    /** A fetch failed; the display formulates it like any other fetch. */
    data class Abruf(val fehler: Ergebnis.Fehler) : PdfFailure

    /** The server reports the job as failed, with its sentence if it sent one. */
    data class Auftrag(val satz: String?) : PdfFailure
}

/** Outcome of a PDF export: the file or the reason. */
sealed interface ExportResult {
    data class Datei(val datei: File) : ExportResult
    data class Fehler(val grund: PdfFailure) : ExportResult
}

/** The PDF export as a foreground service that lives longer than the screen; in the test a double. */
interface PartListsExport {
    /** Where a running export stands, null without an export. */
    val fortschritt: Flow<PdfProgress?>
    suspend fun erzeuge(job: Teilelistenauftrag): ExportResult
}
