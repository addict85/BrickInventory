package ch.brickinventoryapp.dataapi.parts

import ch.brickinventoryapp.model.domain.PartListJob
import ch.brickinventoryapp.model.domain.PdfProgress
import ch.brickinventoryapp.model.outcome.Outcome
import kotlinx.coroutines.flow.Flow
import java.io.File

/** Why a PDF export failed; the UI forms the sentence. */
sealed interface PdfFailure {
    /** A fetch failed; the display formulates it like any other fetch. */
    data class Fetch(val error: Outcome.Failure) : PdfFailure

    /** The server reports the job as failed, with its sentence if it sent one. */
    data class Job(val sentence: String?) : PdfFailure
}

/** Outcome of a PDF export: the file or the reason. */
sealed interface ExportResult {
    data class FileEntry(val file: File) : ExportResult
    data class Failure(val reason: PdfFailure) : ExportResult
}

/** The PDF export as background work that lives longer than the screen; in the test a double. */
interface PartListsExport {
    /** Where a running export stands, null without an export. */
    val progress: Flow<PdfProgress?>
    suspend fun generate(job: PartListJob): ExportResult
}
