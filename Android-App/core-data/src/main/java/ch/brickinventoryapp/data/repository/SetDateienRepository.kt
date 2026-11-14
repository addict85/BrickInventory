package ch.brickinventoryapp.data.repository

import ch.brickinventoryapp.data.api.SetsApi
import ch.brickinventoryapp.vertrag.CsvImportStatus
import ch.brickinventoryapp.vertrag.GenericAdminResponse
import ch.brickinventoryapp.vertrag.GenericResponse
import ch.brickinventoryapp.vertrag.PdfAuftragAnfrage
import ch.brickinventoryapp.vertrag.PdfAuftragStand
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.MultipartBody
import okhttp3.RequestBody.Companion.toRequestBody
import javax.inject.Inject
import javax.inject.Singleton

/** Dateien zu Sets, hinein und hinaus: PDF der Teileliste, CSV-Import, Anleitungen. */
interface SetDateienRepository {
    /** Nimmt den Auftrag an und nennt seine Nummer. */
    suspend fun startPdfJob(auftrag: PdfAuftragAnfrage): Ergebnis<String>

    suspend fun getPdfJobStatus(jobId: String): Ergebnis<PdfAuftragStand>

    /** Das fertige PDF; eine zu kleine Antwort ist eine Fehlerseite, kein PDF. */
    suspend fun downloadPdf(jobId: String): Ergebnis<ByteArray>

    suspend fun getCsvImportStatus(): Ergebnis<CsvImportStatus>

    /** Laufenden CSV-Import abbrechen; schon angelegte Sets bleiben. */
    suspend fun cancelCsvImport(): Ergebnis<GenericAdminResponse>

    /** [typ] ist der Medientyp aus der Dateiauswahl: PDF, JPG oder PNG. */
    suspend fun uploadAnleitung(
        setNumber: String, dateiname: String, typ: String, inhalt: ByteArray, beschreibung: String,
    ): Ergebnis<GenericResponse>

    suspend fun deleteAnleitung(setNumber: String, instrId: Int): Ergebnis<GenericResponse>
}

@Singleton
class SetDateienRepositoryImpl @Inject constructor(private val api: SetsApi) : SetDateienRepository {

    override suspend fun startPdfJob(auftrag: PdfAuftragAnfrage): Ergebnis<String> =
        when (val r = sicherAufrufen { api.startPdfJob(auftrag) }) {
            is Ergebnis.Success -> if (r.data.jobId.isNotBlank()) Ergebnis.Success(r.data.jobId) else Ergebnis.Error.LeereAntwort()
            is Ergebnis.Error -> r
        }

    override suspend fun getPdfJobStatus(jobId: String): Ergebnis<PdfAuftragStand> =
        sicherAufrufen { api.getPdfJobStatus(jobId) }

    override suspend fun downloadPdf(jobId: String): Ergebnis<ByteArray> {
        val r = when (val a = sicherAufrufen { api.downloadPdf(jobId) }) {
            is Ergebnis.Success -> a
            is Ergebnis.Error -> return a
        }
        // Ohne @Streaming liegt der Rumpf schon im Speicher; ein Lesefehler ist trotzdem Transport.
        val bytes = try { r.data.use { it.bytes() } } catch (e: java.io.IOException) {
            return Ergebnis.Error.Netz(technisch = e.message)
        }
        return if (bytes.size > PDF_MINDESTGROESSE) Ergebnis.Success(bytes)
        // Die Grösse gehört ins Log, nicht in die Meldung.
        else Ergebnis.Error.LeereAntwort(technisch = "PDF ${bytes.size} bytes")
    }

    // Über den api-Client wie jeder Abruf: Adresse und Token setzt der Wächter.
    override suspend fun getCsvImportStatus(): Ergebnis<CsvImportStatus> =
        sicherAufrufen { api.getCsvImportStatus() }

    override suspend fun cancelCsvImport(): Ergebnis<GenericAdminResponse> = sicherAufrufen { api.cancelCsvImport() }

    /**
     * Der Typ wird nicht geraten: Der Server leitet die Dateiendung aus ihm ab und
     * lehnt alles ausserhalb seiner Liste ab — `application/octet-stream` würde
     * abgewiesen, obwohl die Datei in Ordnung ist.
     */
    override suspend fun uploadAnleitung(
        setNumber: String, dateiname: String, typ: String, inhalt: ByteArray, beschreibung: String,
    ): Ergebnis<GenericResponse> {
        val teil = MultipartBody.Part.createFormData("file", dateiname, inhalt.toRequestBody(typ.toMediaType()))
        val text = beschreibung.toRequestBody("text/plain".toMediaType())
        return sicherAufrufen { api.uploadAnleitung(setNumber, teil, text) }
    }

    override suspend fun deleteAnleitung(setNumber: String, instrId: Int): Ergebnis<GenericResponse> =
        sicherAufrufen { api.deleteAnleitung(setNumber, instrId) }
}

/** Kleiner ist in der Praxis eine Fehlerseite statt eines PDFs. */
private const val PDF_MINDESTGROESSE = 100
