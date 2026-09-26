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
     * Galerie-Seite vom Server — gefiltert, sortiert, paginiert.
     *
     * Gecacht wird nur die ROHE erste Seite ohne Filter: Eine gefilterte
     * Antwort unter demselben Schlüssel abzulegen hiesse, dass die Antwort
     * eines Kontos unter derselben Adresse läge wie die des ganzen Haushalts —
     * und nach dem nächsten Start der falsche Bestand erschiene.
     *
     * @param accounts Kontofilter des Haushalts (null = Vorgabe „alle").
     */
    suspend fun getSets(
        accounts: String? = null,
        search: String? = null,
        theme: String? = null,
        sort: String? = null,
        page: Int = 1,
        pageSize: Int = GALLERY_PAGE_SIZE,
        storage: String? = null
    ): Result<SetsResponse> {
        // `storage` gehoert in die Bedingung fuer „ungefiltert": Ohne das
        // landete eine nach Lagerort gefilterte Antwort im Zwischenspeicher
        // unter demselben Schluessel wie die volle Liste — und die Galerie
        // zeigte danach je nach Cache-Zustand mal alles, mal eine Kiste.
        val ungefiltert = accounts == null && search.isNullOrBlank() && theme.isNullOrBlank() &&
            storage.isNullOrBlank() &&
            (sort == null || sort == GALLERY_DEFAULT_SORT) && page == 1
        return if (ungefiltert)
            cached("sets", SetsResponse.serializer()) {
                safeCall { api.getSets(null, null, null, sort, 1, pageSize) }
            }
        else safeCall { api.getSets(accounts, search?.ifBlank { null }, theme?.ifBlank { null }, sort, page, pageSize, storage?.ifBlank { null }) }
    }

    /**
     * Steht das Set schon im Blickfeld? Die Regel dahinter (Normalisierung der
     * Nummer, Haushalt) liegt auf dem Server — hier wird nur gefragt.
     */
    suspend fun getSetExists(setNumber: String): Result<ch.brickinventoryapp.data.model.SetExistsResponse> =
        safeCall { api.getSetExists(setNumber) }

    suspend fun getSetDetail(setNumber: String): Result<SetDetailResponse> =
        safeCall { api.getSetDetail(setNumber) }

    /** Setname aus dem gemeinsamen Katalog, auch fuer fremde Sets. */
    suspend fun getSetInfo(setNumber: String): Result<SetInfoResponse> =
        safeCall { api.getSetInfo(setNumber) }

    suspend fun addSet(setNumber: String, quantity: Int = 1, purchasePrice: Double? = null,
                       condition: String? = null, ownerUserId: Int? = null,
                       storage: String? = null): Result<AddSetResponse> =
        safeCall { api.addSet(AddSetRequest(setNumber, quantity, purchasePrice, condition,
                                            ownerUserId, storage)) }

    suspend fun updateQuantity(setNumber: String, quantity: Int, purchasePrice: Double? = null, condition: String? = null): Result<GenericResponse> =
        safeCall { api.updateSetQuantity(setNumber, UpdateQuantityRequest(quantity, purchasePrice, condition)) }

    // ── Merkliste ─────────────────────────────────────────────────────────
    //
    // Hier und nicht in einem eigenen Repository: Ein Merkposten ist ein Set, das
    // man noch nicht hat — dieselbe Sache, andere Tabelle. Ein sechstes
    // Repository fuer vier Aufrufe waere mehr Apparat als Nutzen.

    suspend fun getMerkliste(search: String? = null, condition: String? = null,
                             sort: String? = null, accounts: String? = null): Result<MerklisteResponse> =
        safeCall { api.getMerkliste(search, condition, sort, accounts) }

    suspend fun legeMerkpostenAn(setNumber: String, condition: String,
                             ownerUserId: Int? = null): Result<MerkpostenAntwort> =
        safeCall { api.legeMerkpostenAn(MerkpostenRequest(setNumber, condition, ownerUserId)) }

    suspend fun verschiebeMerkposten(setNumber: String, condition: String,
                                 vonId: Int, zuId: Int): Result<MerkpostenInhaberAntwort> =
        safeCall { api.verschiebeMerkposten(setNumber, condition, MerkpostenInhaberRequest(vonId, zuId)) }

    suspend fun loescheMerkposten(setNumber: String, condition: String,
                              ownerUserId: Int? = null): Result<GenericResponse> =
        safeCall { api.loescheMerkposten(setNumber, condition, ownerUserId) }

    suspend fun getMerkpostenPreise(setNumber: String): Result<MerkpostenPreiseResponse> =
        safeCall { api.getMerkpostenPreise(setNumber) }

    suspend fun uebernimmMerkposten(setNumber: String, condition: String, quantity: Int = 1,
                                purchasePrice: Double? = null, erfasstAls: String? = null,
                                ownerUserId: Int? = null,
                                storage: String? = null): Result<MerkpostenUebernahmeResponse> =
        safeCall { api.uebernimmMerkposten(setNumber, condition,
                                       MerkpostenUebernahmeRequest(quantity, purchasePrice,
                                                               erfasstAls, ownerUserId, storage)) }

    suspend fun deleteSet(setNumber: String): Result<GenericResponse> =
        safeCall { api.deleteSet(setNumber) }

    suspend fun moveSet(setNumber: String, fromUserId: Int?, toUserId: Int,
                        acquisitionIds: List<Int>? = null): Result<MoveSetResponse> =
        safeCall { api.moveSet(setNumber, MoveSetRequest(fromUserId, toUserId, acquisitionIds)) }

    // ── Preisalarm ──────────────────────────────────────────────────────────
    //
    // BEWUSST ohne Zwischenspeicher: Ein Alarm wird selten gelesen (nur beim
    // Oeffnen des Detailbildschirms) und aendert sich durch den Preislauf auch
    // ohne Zutun der App — der Merker `ausgeloest` springt dort um. Ein
    // Speicher zeigte danach „scharf", waehrend die Mail schon unterwegs ist.
    /**
     * Was seit `since` ausgeloest hat.
     *
     * Ohne Zwischenspeicher, und zwar besonders deutlich: Diese Antwort ist
     * genau EINMAL gueltig — beim zweiten Lesen derselben Antwort kaeme
     * dieselbe Meldung ein zweites Mal.
     */
    suspend fun getPendingAlerts(since: String?): Result<PendingAlertsResponse> =
        safeCall { api.getPendingAlerts(since) }

    /** Alle Alarme des Kontos — die Uebersicht in den Einstellungen. */
    suspend fun holeAlleAlarme(): Result<PreisalarmeResponse> =
        safeCall { api.getAlleAlarme() }

    suspend fun getPreisalarme(setNumber: String): Result<PreisalarmeResponse> =
        safeCall { api.getPreisalarme(setNumber) }

    suspend fun setPreisalarm(setNumber: String, richtung: String, schwelle: Double,
                              condition: String = "N"): Result<PreisalarmResponse> =
        safeCall { api.setPreisalarm(setNumber, PreisalarmRequest(richtung, schwelle, condition)) }

    suspend fun deletePreisalarm(setNumber: String, condition: String = "N"):
        Result<PreisalarmResponse> =
        safeCall { api.deletePreisalarm(setNumber, condition) }

    /** Lagerort eines Sets setzen. Leerer Text loescht ihn. */
    suspend fun setSetStorage(setNumber: String, ort: String): Result<LagerortResponse> =
        safeCall { api.setSetStorage(setNumber, LagerortRequest(ort)) }

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

    /** Laufenden CSV-Import abbrechen — siehe BrickApiService.cancelCsvImport. */
    suspend fun cancelCsvImport(): Result<GenericAdminResponse> = safeCall { api.cancelCsvImport() }

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
    /**
     * Eine Anleitung hochladen — PDF, JPG oder PNG.
     *
     * Der Typ kommt aus der Dateiauswahl und wird NICHT geraten: Der Server
     * leitet die Dateiendung aus dem gemeldeten Typ ab und lehnt alles ab, was
     * nicht in seiner festen Liste steht (routes/sets.ts). Ein pauschales
     * `application/octet-stream` fuehrte dort zu einer Absage, obwohl die Datei
     * in Ordnung ist.
     */
    suspend fun uploadAnleitung(
        setNumber: String, dateiname: String, typ: String, inhalt: ByteArray, beschreibung: String,
    ): Result<GenericResponse> {
        val koerper = okhttp3.RequestBody.create(typ.toMediaType(), inhalt)
        val teil = okhttp3.MultipartBody.Part.createFormData("file", dateiname, koerper)
        val text = okhttp3.RequestBody.create("text/plain".toMediaType(), beschreibung)
        return safeCall { api.uploadAnleitung(setNumber, teil, text) }
    }

    suspend fun deleteAnleitung(setNumber: String, instrId: Int): Result<GenericResponse> =
        safeCall { api.deleteAnleitung(setNumber, instrId) }

}
