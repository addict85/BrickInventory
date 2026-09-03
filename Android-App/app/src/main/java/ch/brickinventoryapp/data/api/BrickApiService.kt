package ch.brickinventoryapp.data.api

import ch.brickinventoryapp.data.model.*
import retrofit2.Response
import retrofit2.http.*

interface BrickApiService {

    @POST("api/v1/auth/login")
    suspend fun login(@Body request: LoginRequest): Response<LoginResponse>

    @GET("api/sets/import/csv/status")
    suspend fun getCsvImportStatus(): Response<ch.brickinventoryapp.data.model.CsvImportStatus>

    @GET
    suspend fun getCsvImportStatusDirect(
        @retrofit2.http.Url url: String,
        @Header("Authorization") token: String
    ): Response<ch.brickinventoryapp.data.model.CsvImportStatus>

    @POST("api/auth/qr-login")
    suspend fun qrLogin(@Body request: QrLoginRequest): Response<LoginResponse>

    @POST("api/v1/auth/logout")
    suspend fun logout(): Response<GenericResponse>

    @GET("api/v1/sets/{setNumber}")
    suspend fun getSetDetail(
        @Path("setNumber") setNumber: String
    ): Response<SetDetailResponse>

    // KEIN currency-Parameter mehr: Die Währung bestimmt der Server aus der
    // Nutzereinstellung (seit Manager-Nachtrag 31 ignoriert er den Parameter
    // ohnehin). Der hiesige Startwert "EUR" wurde erst beim ersten Laden der
    // Finanzübersicht vom Server übernommen — bis dahin fragte die
    // Detailansicht EUR an, traf den Cache der eingestellten Währung nie und
    // zeigte teilweise keinen Marktpreis, während Finanzübersicht und
    // Galerie-Kachel (beide ohne Parameter) denselben Preis zeigten.
    @GET("api/v1/sets/{setNumber}/price")
    suspend fun getSetPrice(
        @Path("setNumber") setNumber: String
    ): Response<SetPriceResponse>

    // Auch hier ohne currency: Diese Route hat den Parameter serverseitig
    // nie ausgewertet — der Vorgabewert "CHF" hier (gegen "EUR" beim Preis!)
    // war totes Gewicht und hat die Verwirrung nur vergrössert.
    @GET("api/v1/sets/{setNumber}/price-history")
    suspend fun getSetPriceHistory(
        @Path("setNumber") setNumber: String
    ): Response<PriceHistoryResponse>


    // ── Kontofilter (Haushalt) ────────────────────────────────────────────────
    //
    // `accounts` reist als Anfrageparameter mit: "all" (Vorgabe), "own",
    // "subs" oder die ID EINES Kontos des Haushalts. Der Server übersetzt ihn
    // in Konto-IDs — dadurch kennt ihn jede Zahl derselben Antwort: Liste,
    // Gesamtzahl, Kennzahlen und Summen entstehen aus derselben ID-Liste.
    //
    // Clientseitig zu filtern wäre keine Alternative: Eine Kachelwand liesse
    // sich aussieben, die Gesamtzahl darunter und die Bewertung nicht.
    //
    // null = weglassen; für ein Konto ohne Unterkonten ist der Parameter
    // ohnehin wirkungslos.
    @GET("api/v1/sets")
    /**
     * Galerie — SERVERSEITIG gefiltert, sortiert und seitenweise.
     *
     * Vorher holte die App alles und filterte im Gerät. Das war eine zweite
     * Fassung der Suche: ohne Jahr, ohne Sortierung, und die Themenliste
     * entstand aus der geladenen Liste statt aus dem Bestand. Jetzt gilt
     * dieselbe Regel wie in der Webapp, weil es dieselbe Abfrage ist
     * (utils/handlers.ts, getSets).
     */
    suspend fun getSets(
        @Query("accounts") accounts: String? = null,
        @Query("search") search: String? = null,
        @Query("theme") theme: String? = null,
        @Query("sort") sort: String? = null,
        @Query("page") page: Int? = null,
        @Query("page_size") pageSize: Int? = null
    ): Response<SetsResponse>

    @GET("api/v1/sets/{setNumber}")
    suspend fun getSet(
        @Path("setNumber") setNumber: String
    ): Response<SetResponse>

    @POST("api/v1/sets")
    suspend fun addSet(
        @Body request: AddSetRequest
    ): Response<AddSetResponse>

    @PUT("api/v1/sets/{setNumber}")
    suspend fun updateSetQuantity(
        @Path("setNumber") setNumber: String,
        @Body request: UpdateQuantityRequest
    ): Response<GenericResponse>

    @DELETE("api/v1/sets/{setNumber}")
    suspend fun deleteSet(
        @Path("setNumber") setNumber: String
    ): Response<GenericResponse>

    // Kaufpreis-Historie
    @GET("api/v1/sets/{setNumber}/acquisitions")
    suspend fun getAcquisitions(
        @Path("setNumber") setNumber: String
    ): Response<AcquisitionsResponse>

    @PUT("api/v1/sets/{setNumber}/acquisitions/{acqId}")
    suspend fun updateAcquisition(
        @Path("setNumber") setNumber: String,
        @Path("acqId") acqId: Int,
        @Body body: UpdateAcquisitionRequest
    ): Response<GenericResponse>

    @DELETE("api/v1/sets/{setNumber}/acquisitions/{acqId}")
    suspend fun deleteAcquisition(
        @Path("setNumber") setNumber: String,
        @Path("acqId") acqId: Int
    ): Response<GenericResponse>

    /**
     * Preisverlauf eines manuell erfassten Teils, je Zustand getrennt.
     *
     * Dieselbe Antwortform wie beim Set-Verlauf — deshalb dasselbe Modell.
     * `set_number`, `condition`, `pnl_pct` und `purchase_price` bleiben dabei
     * auf ihren Vorgaben: Sie gehören zum Set-Envelope und liefert diese Route
     * nicht. Was der Dialog braucht — `by_condition` und `chart` — ist gleich.
     */
    @GET("api/v1/parts/{partNumber}/{colorId}/price-history")
    suspend fun getPartPriceHistory(
        @Path("partNumber") partNumber: String,
        @Path("colorId") colorId: Int
    ): Response<PriceHistoryResponse>

    @GET("api/v1/minifigs/{figNumber}/price-history")
    suspend fun getFigPriceHistory(
        @Path("figNumber") figNumber: String
    ): Response<PriceHistoryResponse>

    // Parts acquisitions
    @GET("api/v1/parts/{partNumber}/{colorId}/acquisitions")
    suspend fun getPartAcquisitions(
        @Path("partNumber") partNumber: String,
        @Path("colorId") colorId: Int
    ): Response<AcquisitionsResponse>

    @PUT("api/v1/parts/{partNumber}/{colorId}/acquisitions/{id}")
    suspend fun updatePartAcquisition(
        @Path("partNumber") partNumber: String,
        @Path("colorId") colorId: Int,
        @Path("id") id: Int,
        @Body body: UpdateAcquisitionRequest
    ): Response<GenericResponse>

    @DELETE("api/v1/parts/{partNumber}/{colorId}/acquisitions/{id}")
    suspend fun deletePartAcquisition(
        @Path("partNumber") partNumber: String,
        @Path("colorId") colorId: Int,
        @Path("id") id: Int
    ): Response<DeleteWithQuantityResponse>

    // Minifig acquisitions
    @GET("api/v1/minifigs/{figNumber}/acquisitions")
    suspend fun getFigAcquisitions(
        @Path("figNumber") figNumber: String
    ): Response<AcquisitionsResponse>

    @PUT("api/v1/minifigs/{figNumber}/acquisitions/{id}")
    suspend fun updateFigAcquisition(
        @Path("figNumber") figNumber: String,
        @Path("id") id: Int,
        @Body body: UpdateAcquisitionRequest
    ): Response<GenericResponse>

    @DELETE("api/v1/minifigs/{figNumber}/acquisitions/{id}")
    suspend fun deleteFigAcquisition(
        @Path("figNumber") figNumber: String,
        @Path("id") id: Int
    ): Response<DeleteWithQuantityResponse>

    @GET("api/v1/parts")
    suspend fun getParts(
        @Query("search") search: String? = null,
        @Query("color") color: String? = null,
        @Query("category") category: String? = null,
        @Query("page") page: Int = 1,
        @Query("page_size") pageSize: Int = 500,
        @Query("set_number") setNumber: String? = null,
        @Query("exclude_manual") excludeManual: String? = null,
        @Query("accounts") accounts: String? = null,
        // "0" = ohne Ersatzteile, "1" = nur Ersatzteile, null = alle.
        // Dieselben drei Werte wie das Auswahlfeld der Webapp (parts-spare);
        // der Server liest sie in utils/handlers/parts.ts.
        @Query("spare") spare: String? = null
    ): Response<PartsResponse>

    @GET("api/v1/parts/stats")
    suspend fun getPartsStats(
        @Query("accounts") accounts: String? = null
    ): Response<PartsStatsResponse>

    @GET("api/v1/parts/brick-colors")
    suspend fun getBrickColors(): Response<BrickColorsResponse>

    @POST("api/v1/parts")
    suspend fun addPart(
        @Body request: AddPartRequest
    ): Response<AddPartResponse>

    @POST("api/v1/minifigs")
    suspend fun addMinifig(
        @Body request: AddMinifigRequest
    ): Response<AddMinifigResponse>

    @PUT("api/v1/parts/{partNumber}/{colorId}")
    suspend fun updatePart(
        @Path("partNumber") partNumber: String,
        @Path("colorId") colorId: Int,
        @Body request: UpdateManualItemRequest
    ): Response<GenericResponse>

    @DELETE("api/v1/parts/{partNumber}/{colorId}")
    suspend fun deletePart(
        @Path("partNumber") partNumber: String,
        @Path("colorId") colorId: Int
    ): Response<GenericResponse>

    @PUT("api/v1/minifigs/{figNumber}")
    suspend fun updateMinifig(
        @Path("figNumber") figNumber: String,
        @Body request: UpdateManualItemRequest
    ): Response<GenericResponse>

    @DELETE("api/v1/minifigs/{figNumber}")
    suspend fun deleteMinifig(
        @Path("figNumber") figNumber: String
    ): Response<GenericResponse>

    @GET("api/v1/finance/parts-valuation")
    suspend fun getPartsValuation(
        @Query("accounts") accounts: String? = null
    ): Response<PartsValuationResponse>

    @GET("api/v1/finance/minifigs-valuation")
    suspend fun getMinifigsValuation(
        @Query("accounts") accounts: String? = null
    ): Response<FigsValuationResponse>

    @GET("api/v1/finance/pnl")
    suspend fun getPnl(
        @Query("accounts") accounts: String? = null
    ): Response<PnlResponse>

    @POST("api/v1/sets/partslist-pdf")
    suspend fun startPdfJob(
        @Body body: okhttp3.RequestBody
    ): retrofit2.Response<okhttp3.ResponseBody>

    @GET("api/v1/sets/partslist-pdf/status/{jobId}")
    suspend fun getPdfJobStatus(
        @Path("jobId") jobId: String
    ): retrofit2.Response<okhttp3.ResponseBody>

    @GET("api/v1/sets/partslist-pdf/download/{jobId}")
    suspend fun downloadPdf(
        @Path("jobId") jobId: String
    ): retrofit2.Response<okhttp3.ResponseBody>

    @GET("api/v1/sets/{setNumber}/parts-list")
    suspend fun getSetPartsList(
        @Path("setNumber") setNumber: String
    ): Response<PartsResponse>

    @GET("api/v1/sets/{setNumber}/minifigs-list")
    suspend fun getSetMinifigsList(
        @Path("setNumber") setNumber: String
    ): Response<MinifigsResponse>

    @GET("api/v1/catalog/year-offset")
    suspend fun getCatalogYearOffset(
        @Query("year") year: Int,
        @Query("q") q: String? = null,
        @Query("theme_id") themeId: Int? = null,
        @Query("sort") sort: String? = null,
        @Query("limit") limit: Int? = null
    ): Response<ch.brickinventoryapp.data.model.CatalogYearOffsetResponse>

    @GET("api/v1/sets/exists/{setNumber}")
    suspend fun getSetExists(
        @Path("setNumber") setNumber: String
    ): Response<ch.brickinventoryapp.data.model.SetExistsResponse>

    @GET("api/v1/minifigs/stats")
    suspend fun getMinifigStats(
        @Query("accounts") accounts: String? = null
    ): Response<ch.brickinventoryapp.data.model.MinifigStatsResponse>

    @GET("api/v1/minifigs/{figNumber}/parts")
    suspend fun getMinifigParts(
        @Path("figNumber") figNumber: String
    ): Response<PartsResponse>

    @GET("api/v1/finance/valuation")
    suspend fun getValuation(
        @Query("accounts") accounts: String? = null
    ): Response<ValuationResponse>

    @GET("api/v1/minifigs")
    suspend fun getMinifigs(
        @Query("source") source: String? = null,
        @Query("set_number") setNumber: String? = null,
        @Query("accounts") accounts: String? = null,
        @Query("search") search: String? = null
    ): Response<MinifigsResponse>

    @GET("api/v1/sets/barcode/{barcode}")
    suspend fun getBarcodeSet(
        @Path("barcode") barcode: String
    ): Response<BarcodeResponse>

    @GET("api/v1/finance/portfolio-history")
    suspend fun getPortfolioHistory(
        @Query("period") period: String = "week",
        @Query("accounts") accounts: String? = null
    ): Response<PortfolioHistoryResponse>

    // ── Haushalt: Konten verknüpfen ───────────────────────────────────────────
    //
    // Zustimmen muss zwingend BEIDE Seiten: Das Hauptkonto erzeugt einen
    // Einladungscode, das andere Konto löst ihn in SEINEN Einstellungen ein.
    @GET("api/v1/settings/household")
    suspend fun getHousehold(): Response<HouseholdStatusResponse>

    @POST("api/v1/settings/household/invite")
    suspend fun createHouseholdInvite(): Response<HouseholdInviteResponse>

    @POST("api/v1/settings/household/redeem")
    suspend fun redeemHouseholdInvite(
        @Body body: Map<String, String>
    ): Response<GenericResponse>

    @POST("api/v1/settings/household/unlink")
    suspend fun unlinkHousehold(
        @Body body: Map<String, Int>
    ): Response<GenericResponse>

    /** Konten des Haushalts — für Kontofilter, Kontoauswahl und Verschieben. */
    @GET("api/v1/sets/household-members")
    suspend fun getHouseholdMembers(): Response<HouseholdMembersResponse>

    /**
     * Set — oder einzelne Kaufpreise davon — in ein anderes Konto verschieben.
     *
     * `acquisition_ids` leer = das ganze Set. Wird nur ein Teil verschoben,
     * behält der Absender seine übrigen Exemplare samt Teilen; das Zielkonto
     * bekommt Kopien. Das entscheidet der Server (utils/setMove.ts).
     */
    @POST("api/v1/sets/{setNumber}/move")
    suspend fun moveSet(
        @Path("setNumber") setNumber: String,
        @Body body: MoveSetRequest
    ): Response<MoveSetResponse>

    @GET("api/v1/settings")
    suspend fun getSettings(): Response<SettingsResponse>

    @PUT("api/v1/settings")
    suspend fun updateSettings(
        @Body body: Map<String, String>
    ): Response<GenericResponse>

    @GET("api/v1/stats")
    suspend fun getStats(
        @Query("accounts") accounts: String? = null
    ): Response<StatsResponse>

    @GET("api/v1/auth/me")
    suspend fun getMe(): Response<MeResponse>

    // ── Admin / Monitoring ────────────────────────────────────────────────────
    @GET("api/v1/admin/jobs")
    suspend fun getJobs(): Response<JobsResponse>

    @GET("api/v1/admin/brickset-queue")
    suspend fun getBricksetQueue(): Response<BricksetQueueResponse>

    @POST("api/v1/admin/brickset-queue/{setNumber}/retry")
    suspend fun retryBricksetEntry(
        @Path("setNumber") setNumber: String
    ): Response<GenericAdminResponse>

    @DELETE("api/v1/admin/brickset-queue/{setNumber}")
    suspend fun deleteBricksetEntry(
        @Path("setNumber") setNumber: String
    ): Response<GenericAdminResponse>

    @GET("api/v1/admin/cache-stats")
    suspend fun getCacheStats(): Response<CacheStatsResponse>

    @GET("api/v1/admin/cache-ttl")
    suspend fun getCacheTtl(): Response<CacheTtlResponse>

    @POST("api/v1/admin/cache-ttl")
    suspend fun setCacheTtl(
        @Body body: Map<String, String>
    ): Response<GenericAdminResponse>

    @GET("api/v1/settings/default-condition")
    suspend fun getDefaultCondition(): Response<DefaultConditionResponse>

    // User-level default condition (each user can override).
    // Muss über /api/v1/ laufen (Bearer-Token) — der frühere
    // /api/settings/...-Pfad war session-only (requireLogin) und schlug mit
    // Token still fehl, sodass der in der App gesetzte Default nie ankam.
    @POST("api/v1/settings/user/default-condition")
    suspend fun setUserDefaultCondition(
        @Body body: Map<String, String>
    ): Response<GenericAdminResponse>

    // Admin-level global default
    @POST("api/v1/admin/default-condition")
    suspend fun setDefaultCondition(
        @Body body: Map<String, String>
    ): Response<GenericAdminResponse>

    // getDefaultConditionAdmin() stand hier und zeigte auf
    // api/settings/admin/default-condition. Diese Route ist in Etappe 7
    // geloescht worden; in routes/settings.ts steht an ihrer Stelle nur noch
    // ein Kommentar. Aufgerufen hat die Methode niemand — sie sah aber aus wie
    // ein unterstuetzter Aufruf, und der Naechste haette einen 404 im eigenen
    // Code gesucht. Der globale Standard-Zustand steht unter
    // getGlobalDefaultCondition() (api/v1/settings/default-condition).

    @GET("api/v1/admin/api-limits")
    suspend fun getApiLimits(): Response<ApiLimitsResponse>

    @PUT("api/v1/admin/api-limits")
    suspend fun setApiLimits(
        @Body body: Map<String, Int>
    ): Response<GenericAdminResponse>

    @POST("api/v1/admin/trigger-csv-sync")
    suspend fun triggerCsvSync(): Response<GenericAdminResponse>

    @POST("api/v1/admin/reimport-instructions")
    suspend fun reimportInstructions(): Response<GenericAdminResponse>

    @POST("api/v1/admin/trigger-price-job")
    suspend fun triggerPriceJob(): Response<GenericAdminResponse>

    @POST("api/v1/admin/redownload-missing-images")
    suspend fun redownloadMissingImages(): Response<GenericAdminResponse>

    // ── Katalog ──────────────────────────────────────────────────────────────
    @GET("api/v1/catalog/meta")
    suspend fun getCatalogMeta(): Response<CatalogMetaResponse>

    @GET("api/v1/catalog/sets")
    suspend fun getCatalogSets(
        @Query("q") q: String? = null,
        @Query("theme_id") themeId: Int? = null,
        @Query("year_from") yearFrom: Int? = null,
        @Query("year_to") yearTo: Int? = null,
        @Query("sort") sort: String = "year_desc",
        @Query("page") page: Int = 1,
        @Query("limit") limit: Int = 60
    ): Response<CatalogSetsResponse>

    @GET("api/v1/catalog/sets/{setNumber}")
    suspend fun getCatalogSetDetail(@Path("setNumber") setNumber: String): Response<CatalogSetDetailResponse>
}
