package ch.brickinventoryapp.data.repository

import ch.brickinventoryapp.data.api.BrickApiService
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
 * Ergebnis eines Serveraufrufs — bewusst nur ZWEI Fälle.
 *
 * Es gab lange eine dritte Variante `Loading`, die nirgends erzeugt wurde:
 * [safeCall] liefert ausschliesslich [Success] oder [Error]. Ihr einziger
 * Effekt war, dass jedes `when` einen `else`-Zweig brauchte — und ein
 * `else -> {}` verschluckt stillschweigend auch jeden Fall, der später
 * dazukommt. Mit genau zwei Varianten ist jedes `when` erschöpfend, und
 * eine neue Variante bricht den Build an jeder Stelle, die sie behandeln
 * muss. Bitte keinen `else`-Zweig nachrüsten.
 */
sealed class Result<out T> {
    data class Success<T>(val data: T) : Result<T>()
    // unauthorized = true bei HTTP 401: Der Token ist ungültig/abgelaufen. Von
    // "transient" bewusst getrennt — ein 401 ist kein Netzwerkproblem, das ein
    // Retry beheben könnte, und cached() (unten) darf ihn nicht mit einer alten
    // Antwort aus dem Plattenspeicher überdecken.
    data class Error(
        val message: String,
        val transient: Boolean = false,
        val unauthorized: Boolean = false,
        /**
         * Was schiefging — als AUFZÄHLUNG, nicht als Satz (Nachtrag 116).
         *
         * Bis dahin erzeugte diese Schicht ihre Meldungen selbst: „Netzwerkfehler",
         * „Zeitüberschreitung", „Leere Antwort vom Server". Deutsche Sätze, mitten
         * im Repository — und das Repository hat keinen Context, kann also gar
         * nicht übersetzen. Für einen englischsprachigen Nutzer war damit JEDE
         * Fehlermeldung deutsch, egal wie sauber der Bildschirm darüber
         * lokalisiert war. Dieselbe Ursache wie beim PDF-Betrachter in Nachtrag
         * 115, nur an der Stelle, die alle Fehler formuliert.
         *
         * Jetzt entscheidet diese Schicht nur noch, WAS passiert ist; WIE es
         * heisst, entscheidet die Anzeige (siehe MainViewModel.meldung()).
         *
         * `null` heisst: Der Text kommt vom Server und wird durchgereicht — der
         * kennt seine Fälle genauer als jede Aufzählung hier (Kaufdatum-Konflikt,
         * Währung passt nicht, Code schon eingelöst).
         */
        val art: Fehlerart? = null,
        /** HTTP-Code, falls es einen gab — für die Meldung bei [Fehlerart.SERVER]. */
        val httpCode: Int? = null,
        /**
         * Technischer Text der Ursache, NUR fürs Log. Bewusst getrennt von
         * [message]: Bibliothekstexte wie „unexpected end of stream" sind
         * englisch, wechseln mit der Bibliotheksversion und gehören nicht in
         * eine Oberfläche.
         */
        val technisch: String? = null
    ) : Result<Nothing>()
}

/**
 * Fehlerursachen, die die Datenschicht selbst erkennt.
 *
 * Bewusst grob: Jede Unterscheidung hier muss die Anzeige in einen eigenen
 * Satz übersetzen können. Was der Server im Fehlerrumpf schreibt, ist genauer
 * und wird durchgereicht statt hier einsortiert.
 */
enum class Fehlerart {
    /** Host nicht auflösbar, Verbindung abgelehnt — vorübergehend. */
    NETZ,
    /** Zeitüberschreitung — vorübergehend. */
    ZEIT,
    /** HTTP 2xx, aber kein Rumpf. */
    LEERE_ANTWORT,
    /** HTTP-Fehlercode ohne verwertbaren Fehlerrumpf. */
    SERVER,
    /** Kein Server oder kein Token hinterlegt. */
    NICHT_ANGEMELDET,
    /** Die Gegenseite hat den Datenstrom geschlossen (SSE). */
    VERBINDUNG_BEENDET,
    /** Sitzung abgelaufen (HTTP 401). */
    SITZUNG_ABGELAUFEN,
    /** Sonstiges, ohne nähere Einordnung. */
    UNBEKANNT,
}

/**
 * Seitengrösse der Galerie. Derselbe Wert wie in der Webapp
 * (public/js/02-gallery.js) — der Server deckelt page_size ohnehin, aber zwei
 * verschiedene Seitengrössen ergäben zwei verschiedene Scroll-Erlebnisse für
 * denselben Bestand.
 */
const val GALLERY_PAGE_SIZE = 60

/**
 * Seitengrösse des Katalogs. Muss zur Rechnung des Servers passen: Der
 * Jahres-Sprung liefert `page` für genau diese Grösse, und aus `offset` leitet
 * die Ansicht die Seite selbst ab.
 */
const val CATALOG_PAGE_SIZE = 60

/** Vorgabe-Sortierung; identisch mit SET_SORTS.added_desc auf dem Server. */
const val GALLERY_DEFAULT_SORT = "added_desc"

/** Status eines PDF-Export-Jobs inkl. geschätzter Restdauer (aus fehlenden Bildern). */
data class PdfJobStatus(val status: String, val etaSeconds: Int?)

@Singleton
class BrickRepository @Inject constructor(
    private val api: BrickApiService,
    private val cache: ch.brickinventoryapp.data.cache.ResponseCache
) {

    /**
     * Netzabruf mit Plattenspeicher als Rückfallebene.
     *
     * Reihenfolge ist bewusst „erst Netz, dann Cache": Der Server bleibt die
     * Wahrheit, der Cache springt nur ein, wenn der Abruf scheitert. Ein
     * Cache-First-Ansatz würde frische Daten verdrängen.
     *
     * Nutzen: Nach einem Neustart ohne Netz — oder bei langsamer Verbindung —
     * ist die App gefüllt statt leer. Bisher lud sie bei jedem Öffnen alles neu
     * und blieb offline vollständig unbrauchbar.
     */
    private suspend fun <T : Any> cached(
        key: String,
        serializer: kotlinx.serialization.KSerializer<T>,
        call: suspend () -> Result<T>,
    ): Result<T> {
        val fresh = call()
        if (fresh is Result.Success) {
            cache.put(key, serializer, fresh.data)
            return fresh
        }
        // Eine abgelaufene Sitzung darf nicht durch bis zu 7 Tage alte
        // Plattendaten verdeckt werden — sonst sieht der Nutzer eine scheinbar
        // normale Galerie, obwohl er längst ausgeloggt ist (siehe logout() in
        // SessionFeature.kt, das per SessionExpiredSignal ausgelöst wird).
        if (fresh is Result.Error && fresh.unauthorized) return fresh
        val stored = cache.get(key, serializer)
        return if (stored != null) Result.Success(stored) else fresh
    }

    /** Beim Abmelden aufrufen: Der Cache enthält Daten des angemeldeten Kontos. */
    suspend fun clearCache() = cache.clear()
    // Kein expliziter Authorization-Header mehr nötig: Der OkHttp-Interceptor in
    // AppModule setzt "Bearer <token>" automatisch für alle Requests an unseren
    // Server (aus dem In-Memory-Cache des PreferencesManagers — kein DataStore-
    // Read pro Call mehr). Einzige Ausnahme: getCsvImportStatusDirect, wo der
    // Foreground-Service den Token explizit mitgibt.

    suspend fun login(serverUrl: String, username: String, password: String): Result<LoginResponse> =
        safeCall { api.login(LoginRequest(username, password)) }

    suspend fun getCsvImportStatus(serverUrl: String, token: String): Result<ch.brickinventoryapp.data.model.CsvImportStatus> {
        // Use full URL via Retrofit @Url — bypasses localhost rewrite, uses existing SSL client
        val url = serverUrl.trimEnd('/') + "/api/sets/import/csv/status"
        return safeCall { api.getCsvImportStatusDirect(url, "Bearer $token") }
    }

    suspend fun qrLogin(token: String): Result<LoginResponse> =
        safeCall { api.qrLogin(ch.brickinventoryapp.data.model.QrLoginRequest(token)) }

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

    suspend fun getSetPrice(setNumber: String): Result<SetPriceResponse> =
        safeCall { api.getSetPrice(setNumber) }

    suspend fun getSetPriceHistory(setNumber: String): Result<PriceHistoryResponse> =
        safeCall { api.getSetPriceHistory(setNumber) }

    suspend fun addSet(setNumber: String, quantity: Int = 1, purchasePrice: Double? = null,
                       condition: String? = null, ownerUserId: Int? = null): Result<AddSetResponse> =
        safeCall { api.addSet(AddSetRequest(setNumber, quantity, purchasePrice, condition, ownerUserId)) }

    suspend fun updateQuantity(setNumber: String, quantity: Int, purchasePrice: Double? = null, condition: String? = null): Result<GenericResponse> =
        safeCall { api.updateSetQuantity(setNumber, UpdateQuantityRequest(quantity, purchasePrice, condition)) }

    suspend fun deleteSet(setNumber: String): Result<GenericResponse> =
        safeCall { api.deleteSet(setNumber) }

    suspend fun getParts(search: String? = null, color: String? = null,
                         category: String? = null, page: Int = 1,
                         accounts: String? = null): Result<PartsResponse> =
        // Manuell erfasste Teile haben ihren eigenen Bereich — die Set-Teileliste
        // schließt sie aus (wie in der Webapp).
        // Nur die ungefilterte erste Seite wird gecacht — sie ist das, was nach
        // einem Neustart gebraucht wird. Für Suchergebnisse wäre ein Cache
        // wertlos und würde nur Platz belegen.
        // Auch hier: gecacht wird nur die ungefilterte Sicht (siehe getSets).
        if (search.isNullOrBlank() && color == null && category == null && page == 1 && accounts == null)
            cached("parts", PartsResponse.serializer()) {
                safeCall { api.getParts(null, null, null, 1, pageSize = 500, excludeManual = "1") }
            }
        else safeCall { api.getParts(search, color, category, page, pageSize = 500,
                                     excludeManual = "1", accounts = accounts) }

    suspend fun getPartsStats(accounts: String? = null): Result<PartsStatsResponse> =
        safeCall { api.getPartsStats(accounts) }

    suspend fun getBrickColors(): Result<BrickColorsResponse> =
        safeCall { api.getBrickColors() }

    suspend fun addPart(partNumber: String, colorId: Int = 0, colorName: String? = null, colorHex: String? = null,
                         quantity: Int = 1, note: String? = null, unitPrice: Double? = null,
                         condition: String? = null, ownerUserId: Int? = null): Result<AddPartResponse> =
        safeCall { api.addPart(AddPartRequest(partNumber, colorId, colorName, colorHex, quantity, note, unitPrice, condition, ownerUserId)) }

    suspend fun addMinifig(figNumber: String, blFigNumber: String? = null, quantity: Int = 1, note: String? = null,
                           unitPrice: Double? = null, condition: String? = null,
                           ownerUserId: Int? = null): Result<AddMinifigResponse> =
        safeCall { api.addMinifig(AddMinifigRequest(figNumber, blFigNumber, quantity, note, unitPrice, condition, ownerUserId)) }

    suspend fun updatePart(partNumber: String, colorId: Int, quantity: Int, unitPrice: Double?, condition: String? = null): Result<GenericResponse> =
        safeCall { api.updatePart(partNumber, colorId, UpdateManualItemRequest(quantity, unitPrice, condition = condition)) }

    suspend fun deletePart(partNumber: String, colorId: Int): Result<GenericResponse> =
        safeCall { api.deletePart(partNumber, colorId) }

    suspend fun updateMinifig(figNumber: String, quantity: Int, unitPrice: Double?, blFigNumber: String? = null, condition: String? = null): Result<GenericResponse> =
        safeCall { api.updateMinifig(figNumber, UpdateManualItemRequest(quantity, unitPrice, blFigNumber, condition)) }

    suspend fun deleteMinifig(figNumber: String): Result<GenericResponse> =
        safeCall { api.deleteMinifig(figNumber) }

    suspend fun getPartsValuation(accounts: String? = null): Result<PartsValuationResponse> =
        safeCall { api.getPartsValuation(accounts) }

    suspend fun getMinifigsValuation(accounts: String? = null): Result<FigsValuationResponse> =
        safeCall { api.getMinifigsValuation(accounts) }

    suspend fun getPnl(accounts: String? = null): Result<PnlResponse> =
        safeCall { api.getPnl(accounts) }

    suspend fun getValuation(accounts: String? = null): Result<ValuationResponse> =
        safeCall { api.getValuation(accounts) }

    suspend fun getStats(accounts: String? = null): Result<StatsResponse> =
        if (accounts == null)
            cached("stats", StatsResponse.serializer()) { safeCall { api.getStats() } }
        else safeCall { api.getStats(accounts) }

    suspend fun getMinifigStats(accounts: String? = null): Result<ch.brickinventoryapp.data.model.MinifigStatsResponse> =
        safeCall { api.getMinifigStats(accounts) }

    suspend fun getMinifigs(accounts: String? = null): Result<MinifigsResponse> =
        if (accounts == null)
            cached("minifigs", MinifigsResponse.serializer()) { safeCall { api.getMinifigs() } }
        else safeCall { api.getMinifigs(accounts = accounts) }

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

    suspend fun getSetPartsList(setNumber: String): Result<PartsResponse> =
        safeCall { api.getSetPartsList(setNumber) }

    suspend fun getSetMinifigsList(setNumber: String): Result<MinifigsResponse> =
        safeCall { api.getSetMinifigsList(setNumber) }

    suspend fun getMinifigParts(figNumber: String): Result<PartsResponse> =
        safeCall { api.getMinifigParts(figNumber) }

    suspend fun getMinifigsForSet(setNumber: String): Result<MinifigsResponse> =
        safeCall { api.getMinifigs(setNumber = setNumber) }

    suspend fun getPartsForSet(setNumber: String): Result<PartsResponse> =
        safeCall { api.getParts(page = 1, pageSize = 2000, setNumber = setNumber) }

    suspend fun getPortfolioHistory(period: String = "week", accounts: String? = null): Result<PortfolioHistoryResponse> =
        safeCall { api.getPortfolioHistory(period, accounts) }

    suspend fun resolveBarcode(barcode: String): Result<BarcodeResponse> =
        safeCall { api.getBarcodeSet(barcode) }

    suspend fun getSettings(): Result<SettingsResponse> =
        safeCall { api.getSettings() }

    suspend fun updateSettings(currency: String, condition: String): Result<GenericResponse> =
        safeCall { api.updateSettings(mapOf("currency" to currency, "price_condition" to condition)) }

    private suspend fun <T> safeCall(call: suspend () -> Response<T>): Result<T> {
        return try {
            val response = call()
            if (response.isSuccessful) {
                response.body()?.let { Result.Success(it) }
                    ?: Result.Error("", art = Fehlerart.LEERE_ANTWORT)
            } else {
                // Fehler-Body ({success:false, error:"…"}) auslesen, damit z.B. die
                // Meldung zum Kaufdatum-Konflikt beim Nutzer ankommt statt nur "Conflict".
                val bodyMsg = try {
                    val raw = response.errorBody()?.string()
                    if (!raw.isNullOrBlank()) org.json.JSONObject(raw).optString("error").takeIf { it.isNotBlank() } else null
                } catch (_: Exception) { null }
                // Servermeldung gewinnt, wenn es eine gibt: Sie ist genauer als
                // jede Einordnung hier. Nur wenn keine da ist, wird die Ursache
                // als Aufzählung gemeldet und die Anzeige formuliert den Satz.
                Result.Error(
                    message = bodyMsg ?: "",
                    unauthorized = response.code() == 401,
                    art = when {
                        bodyMsg != null -> null
                        response.code() == 401 -> Fehlerart.SITZUNG_ABGELAUFEN
                        else -> Fehlerart.SERVER
                    },
                    httpCode = response.code()
                )
            }
        } catch (e: kotlinx.coroutines.CancellationException) {
            // Abgebrochene Coroutines (z.B. Suche-Debounce ersetzt Request) dürfen
            // nicht als "Netzwerkfehler" im State landen — Cancellation weiterreichen.
            throw e
        } catch (e: java.net.UnknownHostException) {
            // Vorübergehende Netzwerkfehler explizit als transient markieren, statt
            // sie später an der Fehlermeldung zu erraten (retryOnNetwork nutzt das Flag).
            Result.Error("", transient = true, art = Fehlerart.NETZ)
        } catch (e: java.net.ConnectException) {
            Result.Error("", transient = true, art = Fehlerart.NETZ)
        } catch (e: java.net.SocketTimeoutException) {
            Result.Error("", transient = true, art = Fehlerart.ZEIT)
        } catch (e: Exception) {
            // e.message ist hier durchweg englischer Bibliothekstext ("Socket
            // closed", "unexpected end of stream"). Als Meldung an den Nutzer
            // war das nie sinnvoll; sie steht jetzt im Log-Feld statt im Satz.
            Result.Error("", art = Fehlerart.UNBEKANNT, technisch = e.message)
        }
    }

    suspend fun getMe(): Result<MeResponse> = safeCall { api.getMe() }
    suspend fun getDefaultCondition(): Result<DefaultConditionResponse> = safeCall { api.getDefaultCondition() }
    // User-level: saves per-user default (empty string = revert to global)
    suspend fun setUserDefaultCondition(condition: String): Result<GenericAdminResponse> = safeCall { api.setUserDefaultCondition(mapOf("condition" to condition)) }
    // Admin-level: saves global default (Monitoring)
    suspend fun setDefaultCondition(condition: String): Result<GenericAdminResponse> = safeCall { api.setDefaultCondition(mapOf("condition" to condition)) }

    suspend fun getAcquisitions(setNumber: String): Result<AcquisitionsResponse> =
        safeCall { api.getAcquisitions(setNumber) }

    suspend fun updateAcquisition(setNumber: String, acqId: Int, purchasePrice: Double? = null,
                                  condition: String? = null, quantity: Int? = null, date: String? = null,
                                  ownerUserId: Int? = null): Result<GenericResponse> =
        safeCall { api.updateAcquisition(setNumber, acqId,
            // fuerSet(): Sets tragen den Preis als `purchase_price` — siehe die
            // Erklärung am Modell (Nachtrag 111).
            UpdateAcquisitionRequest.fuerSet(purchasePrice, condition, quantity, date, ownerUserId)) }

    suspend fun deleteAcquisition(setNumber: String, acqId: Int): Result<GenericResponse> =
        safeCall { api.deleteAcquisition(setNumber, acqId) }

    // Parts acquisitions
    // ── Haushalt ──────────────────────────────────────────────────────────────
    suspend fun getHousehold(): Result<HouseholdStatusResponse> =
        safeCall { api.getHousehold() }

    suspend fun getHouseholdMembers(): Result<HouseholdMembersResponse> =
        safeCall { api.getHouseholdMembers() }

    suspend fun createHouseholdInvite(): Result<HouseholdInviteResponse> =
        safeCall { api.createHouseholdInvite() }

    suspend fun redeemHouseholdInvite(code: String): Result<GenericResponse> =
        safeCall { api.redeemHouseholdInvite(mapOf("code" to code)) }

    /** subUserId leer = die eigene Verknüpfung lösen (als Unterkonto). */
    suspend fun unlinkHousehold(subUserId: Int? = null): Result<GenericResponse> =
        safeCall { api.unlinkHousehold(subUserId?.let { mapOf("sub_user_id" to it) } ?: emptyMap()) }

    suspend fun moveSet(setNumber: String, fromUserId: Int?, toUserId: Int,
                        acquisitionIds: List<Int>? = null): Result<MoveSetResponse> =
        safeCall { api.moveSet(setNumber, MoveSetRequest(fromUserId, toUserId, acquisitionIds)) }

    suspend fun getPartPriceHistory(partNumber: String, colorId: Int): Result<PriceHistoryResponse> =
        safeCall { api.getPartPriceHistory(partNumber, colorId) }

    suspend fun getFigPriceHistory(figNumber: String): Result<PriceHistoryResponse> =
        safeCall { api.getFigPriceHistory(figNumber) }

    suspend fun getPartAcquisitions(partNumber: String, colorId: Int): Result<AcquisitionsResponse> =
        safeCall { api.getPartAcquisitions(partNumber, colorId) }
    suspend fun updatePartAcquisition(partNumber: String, colorId: Int, id: Int, req: UpdateAcquisitionRequest): Result<GenericResponse> =
        safeCall { api.updatePartAcquisition(partNumber, colorId, id, req) }
    suspend fun deletePartAcquisition(partNumber: String, colorId: Int, id: Int): Result<DeleteWithQuantityResponse> =
        safeCall { api.deletePartAcquisition(partNumber, colorId, id) }

    // Minifig acquisitions
    suspend fun getFigAcquisitions(figNumber: String): Result<AcquisitionsResponse> =
        safeCall { api.getFigAcquisitions(figNumber) }
    suspend fun updateFigAcquisition(figNumber: String, id: Int, req: UpdateAcquisitionRequest): Result<GenericResponse> =
        safeCall { api.updateFigAcquisition(figNumber, id, req) }
    suspend fun deleteFigAcquisition(figNumber: String, id: Int): Result<DeleteWithQuantityResponse> =
        safeCall { api.deleteFigAcquisition(figNumber, id) }
    suspend fun getCacheStats(): Result<CacheStatsResponse> = safeCall { api.getCacheStats() }
    suspend fun getCacheTtl(): Result<CacheTtlResponse> = safeCall { api.getCacheTtl() }
    suspend fun setCacheTtl(hours: Int): Result<GenericAdminResponse> = safeCall { api.setCacheTtl(mapOf("ttl" to hours.toString())) }
    suspend fun getApiLimits(): Result<ApiLimitsResponse> = safeCall { api.getApiLimits() }
    suspend fun setApiLimits(rb: Int, bl: Int, bs: Int): Result<GenericAdminResponse> = safeCall { api.setApiLimits(mapOf("rebrickable" to rb, "bricklink" to bl, "brickset" to bs)) }
    suspend fun getJobs(): Result<JobsResponse> = safeCall { api.getJobs() }
    suspend fun getBricksetQueue(): Result<BricksetQueueResponse> = safeCall { api.getBricksetQueue() }
    suspend fun retryBricksetEntry(setNumber: String): Result<GenericAdminResponse> = safeCall { api.retryBricksetEntry(setNumber) }
    suspend fun deleteBricksetEntry(setNumber: String): Result<GenericAdminResponse> = safeCall { api.deleteBricksetEntry(setNumber) }
    suspend fun triggerCsvSync(): Result<GenericAdminResponse> = safeCall { api.triggerCsvSync() }
    suspend fun reimportInstructions(): Result<GenericAdminResponse> = safeCall { api.reimportInstructions() }
    suspend fun triggerPriceJob(): Result<GenericAdminResponse> = safeCall { api.triggerPriceJob() }
    suspend fun redownloadMissingImages(): Result<GenericAdminResponse> = safeCall { api.redownloadMissingImages() }

    // ── Katalog ──────────────────────────────────────────────────────────────
    suspend fun getCatalogMeta(): Result<CatalogMetaResponse> =
        cached("catalog-meta", CatalogMetaResponse.serializer()) { safeCall { api.getCatalogMeta() } }
    suspend fun getCatalogSets(
        q: String? = null, themeId: Int? = null, yearFrom: Int? = null, yearTo: Int? = null,
        sort: String = "year_desc", page: Int = 1, limit: Int = 60
    ): Result<CatalogSetsResponse> = safeCall { api.getCatalogSets(q, themeId, yearFrom, yearTo, sort, page, limit) }
    /** Sprungziel des Jahres-Scrubbers — gerechnet mit denselben Filtern wie die Liste. */
    suspend fun getCatalogYearOffset(
        year: Int, q: String? = null, themeId: Int? = null,
        sort: String = "year_desc", limit: Int = CATALOG_PAGE_SIZE
    ): Result<ch.brickinventoryapp.data.model.CatalogYearOffsetResponse> =
        safeCall { api.getCatalogYearOffset(year, q, themeId, sort, limit) }

    suspend fun getCatalogSetDetail(setNumber: String): Result<CatalogSetDetailResponse> =
        safeCall { api.getCatalogSetDetail(setNumber) }
}
