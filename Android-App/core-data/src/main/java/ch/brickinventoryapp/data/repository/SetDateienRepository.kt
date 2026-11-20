package ch.brickinventoryapp.data.repository

import ch.brickinventoryapp.data.api.SetsApi
import ch.brickinventoryapp.model.domain.PdfJobStatus
import ch.brickinventoryapp.model.domain.Teilelistenauftrag
import ch.brickinventoryapp.model.domain.CsvImportStatusView
import ch.brickinventoryapp.contract.PdfAuftragAnfrage
import ch.brickinventoryapp.contract.PdfAuftragSet
import ch.brickinventoryapp.contract.PdfAuftragStand
import ch.brickinventoryapp.contract.PdfAuftragTeil
import ch.brickinventoryapp.contract.mapping.alsAnsicht
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.MultipartBody
import okhttp3.RequestBody.Companion.toRequestBody
import javax.inject.Inject
import javax.inject.Singleton

/** Dateien zu Sets, hinein und hinaus: PDF der Teileliste, CSV-Import, Anleitungen. */
interface SetDateienRepository {
    /** Nimmt den Auftrag an und nennt seine Nummer. */
    suspend fun startPdfJob(job: Teilelistenauftrag): Ergebnis<String>

    suspend fun getPdfJobStatus(jobId: String): Ergebnis<PdfJobStatus>

    /** Das fertige PDF; eine zu kleine Antwort ist eine Fehlerseite, kein PDF. */
    suspend fun downloadPdf(jobId: String): Ergebnis<ByteArray>

    suspend fun getCsvImportStatus(): Ergebnis<CsvImportStatusView>

    /** Laufenden CSV-Import abbrechen; schon angelegte Sets bleiben. */
    suspend fun cancelCsvImport(): Ergebnis<Unit>

    /** [typ] ist der Medientyp aus der Dateiauswahl: PDF, JPG oder PNG. */
    suspend fun uploadInstruction(
        setNumber: String, fileName: String, typ: String, inhalt: ByteArray, beschreibung: String,
    ): Ergebnis<Unit>

    suspend fun deleteAnleitung(setNumber: String, instrId: Int): Ergebnis<Unit>
}

@Singleton
class SetFilesRepositoryImpl @Inject constructor(private val api: SetsApi) : SetDateienRepository {

    override suspend fun startPdfJob(job: Teilelistenauftrag): Ergebnis<String> =
        when (val r = sicherAufrufen { api.startPdfJob(job.asRequest()) }) {
            is Ergebnis.Erfolg -> if (r.data.jobId.isNotBlank()) Ergebnis.Erfolg(r.data.jobId) else Ergebnis.Fehler.LeereAntwort()
            is Ergebnis.Fehler -> r
        }

    override suspend fun getPdfJobStatus(jobId: String): Ergebnis<PdfJobStatus> =
        sicherAufrufen { api.getPdfJobStatus(jobId) }.shown { it.asStatus() }

    override suspend fun downloadPdf(jobId: String): Ergebnis<ByteArray> {
        val r = when (val a = sicherAufrufen { api.downloadPdf(jobId) }) {
            is Ergebnis.Erfolg -> a
            is Ergebnis.Fehler -> return a
        }
        // Ohne @Streaming liegt der Rumpf schon im Speicher; ein Lesefehler ist trotzdem Transport.
        val bytes = try { r.data.use { it.bytes() } } catch (e: java.io.IOException) {
            return Ergebnis.Fehler.Netz(technical = e.message)
        }
        return if (bytes.size > PDF_MIN_SIZE) Ergebnis.Erfolg(bytes)
        // Die Grösse gehört ins Log, nicht in die Meldung.
        else Ergebnis.Fehler.LeereAntwort(technical = "PDF ${bytes.size} bytes")
    }

    // Über den api-Client wie jeder Abruf: Adresse und Token setzt der Wächter.
    override suspend fun getCsvImportStatus(): Ergebnis<CsvImportStatusView> =
        sicherAufrufen { api.getCsvImportStatus() }.shown { it.alsAnsicht() }

    override suspend fun cancelCsvImport(): Ergebnis<Unit> =
        sicherAufrufen { api.cancelCsvImport() }.promised({ it.success }) { }

    /**
     * Der Typ wird nicht geraten: Der Server leitet die Dateiendung aus ihm ab und
     * lehnt alles ausserhalb seiner Liste ab — `application/octet-stream` würde
     * abgewiesen, obwohl die Datei in Ordnung ist.
     */
    override suspend fun uploadInstruction(
        setNumber: String, fileName: String, typ: String, inhalt: ByteArray, beschreibung: String,
    ): Ergebnis<Unit> {
        val teil = MultipartBody.Part.createFormData("file", fileName, inhalt.toRequestBody(typ.toMediaType()))
        val text = beschreibung.toRequestBody("text/plain".toMediaType())
        return sicherAufrufen { api.uploadInstruction(setNumber, teil, text) }.erledigt()
    }

    override suspend fun deleteAnleitung(setNumber: String, instrId: Int): Ergebnis<Unit> =
        sicherAufrufen { api.deleteAnleitung(setNumber, instrId) }.erledigt()
}

internal fun Teilelistenauftrag.asRequest() = PdfAuftragAnfrage(
    sets = sets.map { PdfAuftragSet(setNumber = it.nummer, name = it.name) },
    parts = zeilen.map { z ->
        PdfAuftragTeil(partNumber = z.nummer, blPartNumber = z.blNumber, partName = z.name, colorName = z.farbname,
            colorHex = z.farbHex, colorId = z.farbId, quantity = z.menge, isFig = z.figur, imageUrl = z.bild, imageLocal = z.bildLokal)
    },
)

internal fun PdfAuftragStand.asStatus() = PdfJobStatus(status = status, fehler = error, restSeconds = etaSeconds)

/** Kleiner ist in der Praxis eine Fehlerseite statt eines PDFs. */
private const val PDF_MIN_SIZE = 100
