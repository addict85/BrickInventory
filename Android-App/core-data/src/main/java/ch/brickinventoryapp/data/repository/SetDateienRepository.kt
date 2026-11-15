package ch.brickinventoryapp.data.repository

import ch.brickinventoryapp.data.api.SetsApi
import ch.brickinventoryapp.model.fach.PdfAuftragsstand
import ch.brickinventoryapp.model.fach.Teilelistenauftrag
import ch.brickinventoryapp.model.fach.CsvImportStandAnsicht
import ch.brickinventoryapp.vertrag.PdfAuftragAnfrage
import ch.brickinventoryapp.vertrag.PdfAuftragSet
import ch.brickinventoryapp.vertrag.PdfAuftragStand
import ch.brickinventoryapp.vertrag.PdfAuftragTeil
import ch.brickinventoryapp.vertrag.abbildung.alsAnsicht
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.MultipartBody
import okhttp3.RequestBody.Companion.toRequestBody
import javax.inject.Inject
import javax.inject.Singleton

/** Dateien zu Sets, hinein und hinaus: PDF der Teileliste, CSV-Import, Anleitungen. */
interface SetDateienRepository {
    /** Nimmt den Auftrag an und nennt seine Nummer. */
    suspend fun startPdfJob(auftrag: Teilelistenauftrag): Ergebnis<String>

    suspend fun getPdfJobStatus(jobId: String): Ergebnis<PdfAuftragsstand>

    /** Das fertige PDF; eine zu kleine Antwort ist eine Fehlerseite, kein PDF. */
    suspend fun downloadPdf(jobId: String): Ergebnis<ByteArray>

    suspend fun getCsvImportStatus(): Ergebnis<CsvImportStandAnsicht>

    /** Laufenden CSV-Import abbrechen; schon angelegte Sets bleiben. */
    suspend fun cancelCsvImport(): Ergebnis<Unit>

    /** [typ] ist der Medientyp aus der Dateiauswahl: PDF, JPG oder PNG. */
    suspend fun uploadAnleitung(
        setNumber: String, dateiname: String, typ: String, inhalt: ByteArray, beschreibung: String,
    ): Ergebnis<Unit>

    suspend fun deleteAnleitung(setNumber: String, instrId: Int): Ergebnis<Unit>
}

@Singleton
class SetDateienRepositoryImpl @Inject constructor(private val api: SetsApi) : SetDateienRepository {

    override suspend fun startPdfJob(auftrag: Teilelistenauftrag): Ergebnis<String> =
        when (val r = sicherAufrufen { api.startPdfJob(auftrag.alsAnfrage()) }) {
            is Ergebnis.Success -> if (r.data.jobId.isNotBlank()) Ergebnis.Success(r.data.jobId) else Ergebnis.Error.LeereAntwort()
            is Ergebnis.Error -> r
        }

    override suspend fun getPdfJobStatus(jobId: String): Ergebnis<PdfAuftragsstand> =
        sicherAufrufen { api.getPdfJobStatus(jobId) }.abgebildet { it.alsStand() }

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
    override suspend fun getCsvImportStatus(): Ergebnis<CsvImportStandAnsicht> =
        sicherAufrufen { api.getCsvImportStatus() }.abgebildet { it.alsAnsicht() }

    override suspend fun cancelCsvImport(): Ergebnis<Unit> =
        sicherAufrufen { api.cancelCsvImport() }.zugesagt({ it.success }) { }

    /**
     * Der Typ wird nicht geraten: Der Server leitet die Dateiendung aus ihm ab und
     * lehnt alles ausserhalb seiner Liste ab — `application/octet-stream` würde
     * abgewiesen, obwohl die Datei in Ordnung ist.
     */
    override suspend fun uploadAnleitung(
        setNumber: String, dateiname: String, typ: String, inhalt: ByteArray, beschreibung: String,
    ): Ergebnis<Unit> {
        val teil = MultipartBody.Part.createFormData("file", dateiname, inhalt.toRequestBody(typ.toMediaType()))
        val text = beschreibung.toRequestBody("text/plain".toMediaType())
        return sicherAufrufen { api.uploadAnleitung(setNumber, teil, text) }.erledigt()
    }

    override suspend fun deleteAnleitung(setNumber: String, instrId: Int): Ergebnis<Unit> =
        sicherAufrufen { api.deleteAnleitung(setNumber, instrId) }.erledigt()
}

internal fun Teilelistenauftrag.alsAnfrage() = PdfAuftragAnfrage(
    sets = sets.map { PdfAuftragSet(setNumber = it.nummer, name = it.name) },
    parts = zeilen.map { z ->
        PdfAuftragTeil(partNumber = z.nummer, blPartNumber = z.blNummer, partName = z.name, colorName = z.farbname,
            colorHex = z.farbHex, colorId = z.farbId, quantity = z.menge, isFig = z.figur, imageUrl = z.bild, imageLocal = z.bildLokal)
    },
)

internal fun PdfAuftragStand.alsStand() = PdfAuftragsstand(status = status, fehler = error, restSekunden = etaSeconds)

/** Kleiner ist in der Praxis eine Fehlerseite statt eines PDFs. */
private const val PDF_MINDESTGROESSE = 100
