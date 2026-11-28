package ch.brickinventoryapp.data.collection

import ch.brickinventoryapp.model.domain.CsvImportStatusView
import ch.brickinventoryapp.model.domain.PartListJob
import ch.brickinventoryapp.model.domain.PdfJobStatus
import ch.brickinventoryapp.model.outcome.Outcome

/** Files for sets, in and out: PDF of the parts list, CSV import, instructions. */
interface SetFilesRepository {
    /** Accepts the job and names its number. */
    suspend fun startPdfJob(job: PartListJob): Outcome<String>

    suspend fun getPdfJobStatus(jobId: String): Outcome<PdfJobStatus>

    /** The finished PDF; a too small response is an error page, not a PDF. */
    suspend fun downloadPdf(jobId: String): Outcome<ByteArray>

    suspend fun getCsvImportStatus(): Outcome<CsvImportStatusView>

    /** Cancel the running CSV import; sets already created stay. */
    suspend fun cancelCsvImport(): Outcome<Unit>

    /** [type] is the media type from the file picker: PDF, JPG or PNG. */
    suspend fun uploadInstruction(
        setNumber: String, fileName: String, type: String, content: ByteArray, description: String,
    ): Outcome<Unit>

    suspend fun deleteInstructionNow(setNumber: String, instrId: Int): Outcome<Unit>
}
