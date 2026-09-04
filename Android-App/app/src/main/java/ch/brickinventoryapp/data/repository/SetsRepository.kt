package ch.brickinventoryapp.data.repository

import ch.brickinventoryapp.data.api.BrickApiService
import ch.brickinventoryapp.data.cache.ResponseCache
import ch.brickinventoryapp.data.model.*
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeoutOrNull
import kotlinx.serialization.json.Json
import kotlinx.serialization.decodeFromString
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.RequestBody.Companion.toRequestBody
import retrofit2.Response
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Sets: Bestand, Details, Anlegen, Aendern, PDF-Ausgabe.
 *
 * Teil der Aufteilung von BrickRepository (Nachtrag 155) — die Begruendung
 * steht in RepoBasis.kt. Die Ruempfe sind WORTGLEICH uebernommen; veraendert
 * wurde nichts ausser der Klassenzugehoerigkeit.
 *
 * Erreichbar ueber `repo.sets.…` — BrickRepository haelt die fuenf Teile.
 */
@Singleton
class SetsRepository @Inject constructor(
    api: BrickApiService,
    cache: ResponseCache,
) : RepoBasis(api, cache) {

    /**
     * @param accounts Kontofilter des Haushalts (null = Vorgabe „alle").
     *
     * Der Ablage-Cache greift nur für die UNGEFILTERTE Sicht: Sonst läge die
     * Antwort eines Kontos unter demselben Schlüssel wie die des ganzen
     * Haushalts, und nach einem Neustart erschiene der falsche Bestand.
     */
    /**
     * Galerie-Seite vom Server — gefiltert, sortiert, paginiert.
     *
     * Gecacht wird wie bisher nur die ROHE erste Seite ohne Filter: Eine
     * gefilterte Antwort unter demselben Schlüssel abzulegen hiesse, nach dem
     * nächsten Start den falschen Bestand zu zeigen.
     */
    suspend fun getSets(
        accounts: String? = null,
        search: String? = null,
        theme: String? = null,
        sort: String? = null,
        page: Int = 1,
        pageSize: Int = GALLERY_PAGE_SIZE
    ): Result<SetsResponse> {
        val ungefiltert = accounts == null && search.isNullOrBlank() && theme.isNullOrBlank() &&
            (sort == null || sort == GALLERY_DEFAULT_SORT) && page == 1
        return if (ungefiltert)
            cached("sets", SetsResponse.serializer()) {
                safeCall { api.getSets(null, null, null, sort, 1, pageSize) }
            }
        else safeCall { api.getSets(accounts, search?.ifBlank { null }, theme?.ifBlank { null }, sort, page, pageSize) }
    }

    /**
     * Steht das Set schon im Blickfeld? Die Regel dahinter (Normalisierung der
     * Nummer, Haushalt) liegt auf dem Server — hier wird nur gefragt.
     */
    suspend fun getSetExists(setNumber: String): Result<ch.brickinventoryapp.data.model.SetExistsResponse> =
        safeCall { api.getSetExists(setNumber) }

    suspend fun getSetDetail(setNumber: String): Result<SetDetailResponse> =
        safeCall { api.getSetDetail(setNumber) }

    suspend fun addSet(setNumber: String, quantity: Int = 1, purchasePrice: Double? = null,
                       condition: String? = null, ownerUserId: Int? = null): Result<AddSetResponse> =
        safeCall { api.addSet(AddSetRequest(setNumber, quantity, purchasePrice, condition, ownerUserId)) }

    suspend fun updateQuantity(setNumber: String, quantity: Int, purchasePrice: Double? = null, condition: String? = null): Result<GenericResponse> =
        safeCall { api.updateSetQuantity(setNumber, UpdateQuantityRequest(quantity, purchasePrice, condition)) }

    suspend fun deleteSet(setNumber: String): Result<GenericResponse> =
        safeCall { api.deleteSet(setNumber) }

    suspend fun moveSet(setNumber: String, fromUserId: Int?, toUserId: Int,
                        acquisitionIds: List<Int>? = null): Result<MoveSetResponse> =
        safeCall { api.moveSet(setNumber, MoveSetRequest(fromUserId, toUserId, acquisitionIds)) }

    suspend fun getSetPartsList(setNumber: String): Result<PartsResponse> =
        safeCall { api.getSetPartsList(setNumber) }

    suspend fun getSetMinifigsList(setNumber: String): Result<MinifigsResponse> =
        safeCall { api.getSetMinifigsList(setNumber) }

    suspend fun getMinifigsForSet(setNumber: String): Result<MinifigsResponse> =
        safeCall { api.getMinifigs(setNumber = setNumber) }

    suspend fun getPartsForSet(setNumber: String): Result<PartsResponse> =
        safeCall { api.getParts(page = 1, pageSize = 2000, setNumber = setNumber) }

    suspend fun resolveBarcode(barcode: String): Result<BarcodeResponse> =
        safeCall { api.getBarcodeSet(barcode) }

    suspend fun getCsvImportStatus(serverUrl: String, token: String): Result<ch.brickinventoryapp.data.model.CsvImportStatus> {
        // Use full URL via Retrofit @Url — bypasses localhost rewrite, uses existing SSL client
        // Umgezogen nach /api/v1 — ein Adressraum (siehe server.ts).
        val url = serverUrl.trimEnd('/') + "/api/v1/sets/import/csv/status"
        return safeCall { api.getCsvImportStatusDirect(url, "Bearer $token") }
    }

    suspend fun triggerCsvSync(): Result<GenericAdminResponse> = safeCall { api.triggerCsvSync() }

    suspend fun reimportInstructions(): Result<GenericAdminResponse> = safeCall { api.reimportInstructions() }

    /** Download finished PDF — returns bytes */
    suspend fun downloadPdf(jobId: String): Result<ByteArray> {
        return try {
            val response = api.downloadPdf(jobId)
            if (response.isSuccessful) {
                val bytes = response.body()?.bytes() ?: ByteArray(0)
                if (bytes.size > 100) Result.Success(bytes)
                // Zu kleine Antwort heisst in der Praxis: Fehlerseite statt PDF.
                // Die Grösse gehört ins Log, nicht in die Meldung.
                else Result.Error("", art = Fehlerart.LEERE_ANTWORT, technisch = "PDF ${bytes.size} bytes")
            } else {
                Result.Error("", art = Fehlerart.SERVER, httpCode = response.code())
            }
        } catch (e: Exception) {
            Result.Error("", art = Fehlerart.UNBEKANNT, technisch = e.message)
        }
    }

    /** Start async PDF job — returns jobId or error */
    suspend fun startPdfJob(bodyJson: String): Result<String> {
        return try {
            val requestBody = bodyJson.toRequestBody("application/json; charset=utf-8".toMediaType())
            val response = api.startPdfJob(requestBody)
            if (response.isSuccessful) {
                val body = response.body()?.string() ?: ""
                val jobId = org.json.JSONObject(body).optString("jobId", "")
                if (jobId.isNotBlank()) Result.Success(jobId)
                else Result.Error("", art = Fehlerart.LEERE_ANTWORT)
            } else {
                Result.Error("", art = Fehlerart.SERVER, httpCode = response.code())
            }
        } catch (e: Exception) {
            Result.Error("", art = Fehlerart.UNBEKANNT, technisch = e.message)
        }
    }

    /** Poll PDF job status — returns "running", "done", or "error" */
    suspend fun getPdfJobStatus(jobId: String): Result<PdfJobStatus> {
        return try {
            val response = api.getPdfJobStatus(jobId)
            if (response.isSuccessful) {
                val body = response.body()?.string() ?: ""
                val obj = org.json.JSONObject(body)
                val status = obj.optString("status", "error")
                val eta = if (obj.has("etaSeconds") && !obj.isNull("etaSeconds")) obj.optInt("etaSeconds") else null
                Result.Success(PdfJobStatus(status, eta))
            } else {
                Result.Error("", art = Fehlerart.SERVER, httpCode = response.code())
            }
        } catch (e: Exception) {
            Result.Error("", art = Fehlerart.UNBEKANNT, technisch = e.message)
        }
    }
}
