package ch.brickinventoryapp.data.repository

import ch.brickinventoryapp.data.api.SetsApi
import ch.brickinventoryapp.model.domain.PdfJobStatus
import ch.brickinventoryapp.model.domain.PartListJob
import ch.brickinventoryapp.model.domain.CsvImportStatusView
import ch.brickinventoryapp.contract.PdfAuftragAnfrage
import ch.brickinventoryapp.contract.PdfAuftragSet
import ch.brickinventoryapp.contract.PdfAuftragStand
import ch.brickinventoryapp.contract.PdfAuftragTeil
import ch.brickinventoryapp.contract.mapping.asView
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.MultipartBody
import okhttp3.RequestBody.Companion.toRequestBody
import javax.inject.Inject
import javax.inject.Singleton

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

@Singleton
class SetFilesRepositoryImpl @Inject constructor(private val api: SetsApi) : SetFilesRepository {

    override suspend fun startPdfJob(job: PartListJob): Outcome<String> =
        when (val r = safeCall { api.startPdfJob(job.asRequest()) }) {
            is Outcome.Success -> if (r.data.jobId.isNotBlank()) Outcome.Success(r.data.jobId) else Outcome.Failure.EmptyResponse()
            is Outcome.Failure -> r
        }

    override suspend fun getPdfJobStatus(jobId: String): Outcome<PdfJobStatus> =
        safeCall { api.getPdfJobStatus(jobId) }.mapData { it.asStatus() }

    override suspend fun downloadPdf(jobId: String): Outcome<ByteArray> {
        val r = when (val a = safeCall { api.downloadPdf(jobId) }) {
            is Outcome.Success -> a
            is Outcome.Failure -> return a
        }
        // Without @Streaming the body already lies in memory; a read error is still transport.
        val bytes = try { r.data.use { it.bytes() } } catch (e: java.io.IOException) {
            return Outcome.Failure.Network(technical = e.message)
        }
        return if (bytes.size > PDF_MIN_SIZE) Outcome.Success(bytes)
        // The size belongs in the log, not in the message.
        else Outcome.Failure.EmptyResponse(technical = "PDF ${bytes.size} bytes")
    }

    // Via the api client like every fetch: the guard sets address and token.
    override suspend fun getCsvImportStatus(): Outcome<CsvImportStatusView> =
        safeCall { api.getCsvImportStatus() }.mapData { it.asView() }

    override suspend fun cancelCsvImport(): Outcome<Unit> =
        safeCall { api.cancelCsvImport() }.promised({ it.success }) { }

    /**
     * The type is not guessed: the server derives the file extension from it and
     * rejects everything outside its list — `application/octet-stream` would be
     * rejected although the file is fine.
     */
    override suspend fun uploadInstruction(
        setNumber: String, fileName: String, type: String, content: ByteArray, description: String,
    ): Outcome<Unit> {
        val part = MultipartBody.Part.createFormData("file", fileName, content.toRequestBody(type.toMediaType()))
        val text = description.toRequestBody("text/plain".toMediaType())
        return safeCall { api.uploadInstruction(setNumber, part, text) }.done()
    }

    override suspend fun deleteInstructionNow(setNumber: String, instrId: Int): Outcome<Unit> =
        safeCall { api.deleteInstructionNow(setNumber, instrId) }.done()
}

internal fun PartListJob.asRequest() = PdfAuftragAnfrage(
    sets = sets.map { PdfAuftragSet(setNumber = it.number, name = it.name) },
    parts = rows.map { z ->
        PdfAuftragTeil(partNumber = z.number, blPartNumber = z.blNumber, partName = z.name, colorName = z.colorName,
            colorHex = z.colorHex, colorId = z.colorId, quantity = z.quantity, isFig = z.figure, imageUrl = z.image, imageLocal = z.imageLocal)
    },
)

internal fun PdfAuftragStand.asStatus() = PdfJobStatus(status = status, error = error, restSeconds = etaSeconds)

/** Smaller is in practice an error page instead of a PDF. */
private const val PDF_MIN_SIZE = 100
