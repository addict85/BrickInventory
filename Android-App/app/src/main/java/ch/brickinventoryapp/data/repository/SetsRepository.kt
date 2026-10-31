package ch.brickinventoryapp.data.repository

import ch.brickinventoryapp.data.api.SetsApi
import ch.brickinventoryapp.data.cache.ResponseCache
import ch.brickinventoryapp.data.lokal.Bearbeitung
import ch.brickinventoryapp.data.lokal.Faecher
import ch.brickinventoryapp.data.lokal.Lokal
import kotlinx.coroutines.flow.Flow
import ch.brickinventoryapp.data.lokal.Offlineablage
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
 * Sets: Bestand, Details, Anlegen, Ändern, PDF-Ausgabe — eines der Sachgebiete der
 * Datenschicht, erreichbar über `repo.sets.…`; die Begründung der Aufteilung steht
 * in RepoBasis.kt.
 */
@Singleton
class SetsRepository @Inject constructor(
    api: SetsApi,
    cache: ResponseCache,
    ablage: Offlineablage = Offlineablage.fluechtig(),
) : RepoBasis<SetsApi>(api, cache, ablage) {

    /**
     * Galerie-Seite vom Server — gefiltert, sortiert, paginiert. Lokal abgelegt wird
     * nur die ungefilterte Liste (Seite für Seite): Eine gefilterte Antwort erschiene
     * offline als der ganze Bestand.
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
        // `storage` gehört in die Bedingung für „ungefiltert“: Sonst landete eine nach
        // Lagerort gefilterte Antwort unter dem Schlüssel der vollen Liste, und die
        // Galerie zeigte je nach Cache-Zustand mal alles, mal eine Kiste.
        val ungefiltert = accounts == null && search.isNullOrBlank() && theme.isNullOrBlank() &&
            storage.isNullOrBlank() &&
            (sort == null || sort == GALLERY_DEFAULT_SORT)
        return if (ungefiltert)
            abgeglichen(Faecher.SETS, { it.sets },
                { SetsResponse(success = true, count = it.size, sets = it, total = it.size) },
                anhaengen = page > 1) {
                safeCall { api.getSets(null, null, null, sort, page, pageSize) }
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
                       storage: String? = null): Result<AddSetResponse> {
        val anfrage = AddSetRequest(setNumber, quantity, purchasePrice, condition, ownerUserId, storage)
        return schreibe(Bearbeitung.SetErfassen(anfrage),
            { AddSetResponse(success = true, action = "gepuffert", setNumber = setNumber) }) {
            safeCall { api.addSet(anfrage) }
        }
    }

    suspend fun updateQuantity(setNumber: String, quantity: Int, purchasePrice: Double? = null, condition: String? = null): Result<GenericResponse> =
        safeCall { api.updateSetQuantity(setNumber, UpdateQuantityRequest(quantity, null, purchasePrice, condition)) }

    /** Menge um [schritt] ändern; der Server rechnet unter Bestandssperre. */
    suspend fun aendereMengeUm(setNumber: String, schritt: Int): Result<GenericResponse> =
        schreibe(Bearbeitung.SetMenge(setNumber, schritt), { GenericResponse(success = true) }) {
            safeCall { api.updateSetQuantity(setNumber, UpdateQuantityRequest(quantityDelta = schritt)) }
        }

    // ── Merkliste ─────────────────────────────────────────────────────────
    //
    // Hier und nicht in einem eigenen Repository: Ein Merkposten ist ein Set, das
    // man noch nicht hat — dieselbe Sache, andere Tabelle. Ein sechstes
    // Repository fuer vier Aufrufe waere mehr Apparat als Nutzen.

    /** Lokal abgelegt wird nur die ungefilterte Liste — wie bei der Galerie. */
    suspend fun getMerkliste(search: String? = null, condition: String? = null,
                             sort: String? = null, accounts: String? = null): Result<MerklisteResponse> =
        if (search.isNullOrBlank() && condition.isNullOrBlank() && accounts == null &&
            (sort == null || sort == MERKLISTE_DEFAULT_SORT))
            abgeglichen(Faecher.MERKLISTE, { it.merkposten }, { MerklisteResponse(success = true, merkposten = it) }) {
                safeCall { api.getMerkliste(search, condition, sort, accounts) }
            }
        else safeCall { api.getMerkliste(search, condition, sort, accounts) }

    suspend fun legeMerkpostenAn(setNumber: String, condition: String,
                             ownerUserId: Int? = null): Result<MerkpostenAntwort> {
        val anfrage = MerkpostenRequest(setNumber, condition, ownerUserId)
        return schreibe(Bearbeitung.MerkpostenAnlegen(anfrage), {
            MerkpostenAntwort(success = true, warNeu = true,
                merkposten = Merkposten(setNumber = setNumber, condition = condition, userId = ownerUserId ?: 0))
        }) { safeCall { api.legeMerkpostenAn(anfrage) } }
    }

    suspend fun verschiebeMerkposten(setNumber: String, condition: String,
                                 vonId: Int, zuId: Int): Result<MerkpostenInhaberAntwort> =
        safeCall { api.verschiebeMerkposten(setNumber, condition, MerkpostenInhaberRequest(vonId, zuId)) }

    suspend fun loescheMerkposten(setNumber: String, condition: String,
                              ownerUserId: Int? = null): Result<GenericResponse> =
        schreibe(Bearbeitung.MerkpostenLoeschen(setNumber, condition, ownerUserId), { GenericResponse(success = true) }) {
            safeCall { api.loescheMerkposten(setNumber, condition, ownerUserId) }
        }

    suspend fun getMerkpostenPreise(setNumber: String): Result<MerkpostenPreiseResponse> =
        safeCall { api.getMerkpostenPreise(setNumber) }

    suspend fun uebernimmMerkposten(setNumber: String, condition: String, quantity: Int = 1,
                                purchasePrice: Double? = null, erfasstAls: String? = null,
                                ownerUserId: Int? = null,
                                storage: String? = null): Result<MerkpostenUebernahmeResponse> =
        safeCall { api.uebernimmMerkposten(setNumber, condition,
                                       MerkpostenUebernahmeRequest(quantity, purchasePrice,
                                                               erfasstAls, ownerUserId, storage)) }

    /** Löschen nur online: Der Papierkorb des Servers entscheidet, was zurückkommt. */
    suspend fun deleteSet(setNumber: String): Result<GenericResponse> =
        safeCall { api.deleteSet(setNumber) }.also { if (it is Result.Success) ablage.entferne(Faecher.SETS, setNumber) }

    /** Die lokale Liste der Galerie (ungefiltert); sie ändert sich auch durch offline Bearbeitetes. */
    fun beobachteSets(): Flow<Lokal<SetItem>> = ablage.beobachte(Faecher.SETS)

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
    suspend fun getAlleAlarme(): Result<PreisalarmeResponse> =
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

    /** Laufenden CSV-Import abbrechen — siehe SetsApi.cancelCsvImport. */
    suspend fun cancelCsvImport(): Result<GenericAdminResponse> = safeCall { api.cancelCsvImport() }

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
     * Eine Anleitung hochladen — PDF, JPG oder PNG. Der Typ kommt aus der Dateiauswahl
     * und wird nicht geraten: Der Server leitet die Dateiendung aus dem gemeldeten Typ
     * ab und lehnt alles ausserhalb seiner festen Liste ab (routes/sets.ts) —
     * `application/octet-stream` würde abgewiesen, obwohl die Datei in Ordnung ist.
     */
    suspend fun uploadAnleitung(
        setNumber: String, dateiname: String, typ: String, inhalt: ByteArray, beschreibung: String,
    ): Result<GenericResponse> {
        val koerper = inhalt.toRequestBody(typ.toMediaType())
        val teil = okhttp3.MultipartBody.Part.createFormData("file", dateiname, koerper)
        val text = beschreibung.toRequestBody("text/plain".toMediaType())
        return safeCall { api.uploadAnleitung(setNumber, teil, text) }
    }

    suspend fun deleteAnleitung(setNumber: String, instrId: Int): Result<GenericResponse> =
        safeCall { api.deleteAnleitung(setNumber, instrId) }
}
