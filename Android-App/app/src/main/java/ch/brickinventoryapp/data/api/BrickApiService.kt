package ch.brickinventoryapp.data.api

import ch.brickinventoryapp.data.model.*
import retrofit2.Response
import retrofit2.http.*

/**
 * Alle Bereiche zusammen. Die App injiziert nur die Bereiche (NetzModule), jedes
 * Repository sieht nur seinen; diese Summe gibt es für Tests, die mit einem
 * Testserver alle Repositories bauen. Alle Bereiche stehen in dieser einen
 * Datei, weil die Vertragsprüfungen des Web sie lesen.
 */
interface BrickApiService : AdminApi, SetsApi, TeileApi, HaushaltApi, FinanzenApi, GutscheineApi

/**
 * Teile und Figuren abfragen — für die Teile-Reiter und für den Inhalt eines
 * Sets; Sets- und Teile-Bereich erben sie beide.
 */
interface BestandsInhaltApi {

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
        @Query("spare") spare: String? = null,
        // "1" holt zusaetzlich, in welchen Sets das Teil steckt. Kostet den
        // Server eine eigene Abfrage — deshalb nur in der Tabellenansicht,
        // genau wie in der Webapp (parts-view === 'table').
        @Query("with_sets") withSets: String? = null,
        /** Lagerort — eigener Parameter, nicht Teil der Suche (siehe Server). */
        @Query("storage") storage: String? = null
    ): Response<PartsResponse>

    @GET("api/v1/minifigs")
    suspend fun getMinifigs(
        @Query("source") source: String? = null,
        @Query("set_number") setNumber: String? = null,
        @Query("accounts") accounts: String? = null,
        @Query("search") search: String? = null
    ): Response<MinifigsResponse>
}

/** Anmeldung, Konto, zweiter Faktor, CSV-Import, Einstellungen, Hintergrundarbeiten, Katalog (AdminRepository). */
interface AdminApi {

    @POST("api/v1/auth/login")
    suspend fun login(@Body request: LoginRequest): Response<LoginResponse>

    @POST("api/v1/auth/qr-login")
    suspend fun qrLogin(@Body request: QrLoginRequest): Response<LoginResponse>

    @POST("api/v1/auth/logout")
    suspend fun logout(): Response<GenericResponse>

    // ── Konto anlegen und Passwort vergessen ──
    //
    // Ohne Anmeldung, weil sie gebraucht werden, bevor es einen Token gibt; der Server
    // lässt sie vor requireLogin stehen (routes/auth.ts).
    @GET("api/v1/auth/registration-status")
    suspend fun getRegistrationStatus(): Response<RegistrationStatusResponse>

    @POST("api/v1/auth/register")
    suspend fun register(@Body request: RegisterRequest): Response<RegisterResponse>

    @POST("api/v1/auth/forgot-password")
    suspend fun forgotPassword(@Body request: ForgotPasswordRequest): Response<ForgotPasswordResponse>

    // ── Das eigene Konto ────────────────────────────────────────────────────
    @GET("api/v1/auth/profile")
    suspend fun getProfil(): Response<ProfilResponse>

    @PUT("api/v1/auth/profile")
    suspend fun updateProfil(@Body request: ProfilAenderung): Response<GenericResponse>

    @POST("api/v1/auth/change-password")
    suspend fun changePassword(@Body request: PasswortAenderung): Response<GenericResponse>

    // Zweiter Faktor. Das Zurücksetzen durch einen Verwalter fehlt hier
    // absichtlich — die Nutzerverwaltung steht nur in der Webapp.
    @GET("api/v1/auth/zweiter-faktor")
    suspend fun zweiterFaktorStand(): Response<ZweiterFaktorStand>

    @POST("api/v1/auth/zweiter-faktor/einrichten")
    suspend fun zweiterFaktorEinrichten(@Body request: ZweiterFaktorAnfrage): Response<ZweiterFaktorEinrichtung>

    @POST("api/v1/auth/zweiter-faktor/bestaetigen")
    suspend fun zweiterFaktorBestaetigen(@Body request: ZweiterFaktorAnfrage): Response<ZweiterFaktorCodes>

    @POST("api/v1/auth/zweiter-faktor/abschalten")
    suspend fun zweiterFaktorAbschalten(@Body request: ZweiterFaktorAnfrage): Response<GenericResponse>

    @POST("api/v1/auth/zweiter-faktor/codes")
    suspend fun zweiterFaktorNeueCodes(@Body request: ZweiterFaktorAnfrage): Response<ZweiterFaktorCodes>

    // ── CSV-Import: dieselben Adressen wie in der Webapp ──
    //
    // `@retrofit2.http.Part` ausgeschrieben: Die beiden Sternimporte bringen je ein
    // `Part` (Datenklasse und Annotation), und Kotlin übersetzt die Mehrdeutigkeit
    // nicht. Drei Aufrufe statt eines mit Pfadparameter, weil es drei Router sind.
    @Multipart
    @POST("api/v1/sets/import/csv")
    suspend fun importSetsCsv(@retrofit2.http.Part datei: okhttp3.MultipartBody.Part): Response<CsvImportErgebnis>

    @Multipart
    @POST("api/v1/parts/import/csv")
    suspend fun importPartsCsv(@retrofit2.http.Part datei: okhttp3.MultipartBody.Part): Response<CsvImportErgebnis>

    @Multipart
    @POST("api/v1/minifigs/import/csv")
    suspend fun importMinifigsCsv(@retrofit2.http.Part datei: okhttp3.MultipartBody.Part): Response<CsvImportErgebnis>

    // Die Merkliste liegt NICHT unter einem eigenen alten Router wie Sets,
    // Teile und Minifiguren, sondern vollstaendig in routes/api_v1/wanted.ts —
    // deshalb steht ihr Import dort und nicht unter api/v1/merkliste/.
    @Multipart
    @POST("api/v1/wanted/import/csv")
    suspend fun importMerklisteCsv(@retrofit2.http.Part datei: okhttp3.MultipartBody.Part): Response<CsvImportErgebnis>

    // Preisalarme. Die Adresse liegt unter /alerts und nicht unter
    // /sets/<nr>/alert, weil die Datei VIELE Sets traegt — die Einzelroute
    // nebenan setzt genau einen Alarm.
    @Multipart
    @POST("api/v1/alerts/import/csv")
    suspend fun importAlarmeCsv(@retrofit2.http.Part datei: okhttp3.MultipartBody.Part): Response<CsvImportErgebnis>

    // ── Server-Protokoll (nur für Verwalter) ──
    //
    // Die Nutzerverwaltung (/auth/users) fehlt hier mit Absicht: Sie gehört an den
    // Rechner, nicht aufs Telefon.
    @GET("api/v1/admin/logs")
    suspend fun getProtokoll(@Query("minutes") minuten: Int): Response<ProtokollResponse>

    /**
     * Startzustand des Servers — ohne Anmeldung, weil er gebraucht wird, bevor sich
     * jemand anmelden kann.
     */
    @GET("api/v1/startup-status")
    suspend fun getStartupStatus(): Response<ch.brickinventoryapp.data.model.StartupStatus>

    /**
     * Das globale Design des Servers — ohne Anmeldung: Anmelde- und
     * Einrichtungsbildschirm sollen schon im richtigen Design erscheinen.
     */
    @GET("api/v1/settings/theme")
    suspend fun getAppTheme(): Response<ch.brickinventoryapp.data.model.AppThemeResponse>

    @GET("api/v1/catalog/year-verteilung")
    suspend fun getCatalogYearVerteilung(
        @Query("q") q: String? = null,
        @Query("theme_id") themeId: Int? = null,
        @Query("sort") sort: String? = null
    ): Response<ch.brickinventoryapp.data.model.CatalogYearVerteilungResponse>

    @GET("api/v1/settings")
    suspend fun getSettings(): Response<SettingsResponse>

    @PUT("api/v1/settings")
    suspend fun updateSettings(
        @Body body: Map<String, String>
    ): Response<GenericResponse>

    @GET("api/v1/auth/me")
    suspend fun getMe(): Response<MeResponse>

    // ── Angemeldete Geraete ──────────────────────────────────────────────────
    // Beide Adressen gab es schon; sie waren nur sitzungsgebunden und damit
    // fuer die App nicht erreichbar. Seit der Token-Verwaltung nehmen sie
    // Sitzung ODER Bearer-Token (requireLoginOrToken), wie der Rest von /api/v1.
    @GET("api/v1/settings/tokens")
    suspend fun getTokens(): Response<TokensResponse>

    @DELETE("api/v1/settings/tokens/{tokenId}")
    suspend fun revokeToken(@Path("tokenId") tokenId: String): Response<GenericResponse>

    // ── Admin / Monitoring ────────────────────────────────────────────────────
    @GET("api/v1/admin/jobs")
    suspend fun getJobs(): Response<JobsResponse>

    /**
     * Den Zeitplan eines Jobs ändern, in einer der beiden Formen, die der Server
     * liest:
     *
     *   { name: <schluessel>, time: "HH:MM" }   tägliche Jobs
     *   { name: "priceJob",   minutes: <n> }    der Preis-Job
     *
     * Eine Map, weil der Server am vorhandenen Feld unterscheidet.
     */
    @POST("api/v1/admin/job-schedule")
    suspend fun setJobSchedule(@Body body: Map<String, @JvmSuppressWildcards Any>): Response<GenericAdminResponse>

    /**
     * Fehlende Katalogbilder einreihen. Nicht redownloadMissingImages: Das holt die
     * Bilder des Bestands.
     */
    @POST("api/v1/admin/catalog-images")
    suspend fun queueCatalogImages(): Response<GenericAdminResponse>

    /**
     * Das globale Design umstellen — nur für Verwalter, damit es nicht nur am Rechner
     * geht.
     */
    @POST("api/v1/settings/admin/theme")
    suspend fun setAppTheme(@Body body: Map<String, String>): Response<GenericAdminResponse>

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

    /**
     * Den Preis-Cache leeren; mit `all=true` auch Teilmengen und Katalog. Global und
     * nur für Verwalter: `price_cache` gehört niemandem, und jeder Neuaufbau kostet
     * Anfragen aus dem gemeinsamen Tageskontingent.
     */
    @POST("api/v1/admin/cache-clear")
    suspend fun clearCache(
        @Body body: Map<String, Boolean> = emptyMap()
    ): Response<GenericAdminResponse>

    // Der globale Standard-Zustand steht unter getGlobalDefaultCondition()
    // (api/v1/settings/default-condition).

    @GET("api/v1/admin/api-limits")
    suspend fun getApiLimits(): Response<ApiLimitsResponse>

    @PUT("api/v1/admin/api-limits")
    suspend fun setApiLimits(
        @Body body: Map<String, Int>
    ): Response<GenericAdminResponse>

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

/** Sets, Anleitungen, Preisalarme, Lagerort je Set, Merkliste, PDF-Export, Teilelisten (SetsRepository). */
interface SetsApi : BestandsInhaltApi {

    // Umgezogen nach /api/v1: Seit der Zusammenfuehrung gibt es nur noch EINEN
    // Adressraum. Der Router dahinter ist derselbe wie vorher — nur die Adresse
    // hat sich geaendert (siehe server.ts).
    @GET("api/v1/sets/import/csv/status")
    suspend fun getCsvImportStatus(): Response<ch.brickinventoryapp.data.model.CsvImportStatus>

    /**
     * Einen laufenden CSV-Import abbrechen. Der Server vermerkt nur `cancelled`; schon
     * angelegte Sets bleiben — abgebrochen heisst „ab hier nicht weiter“, nicht
     * „rückgängig“, wie in der Webapp.
     */
    @POST("api/v1/sets/import/csv/cancel")
    suspend fun cancelCsvImport(): Response<GenericAdminResponse>

    @GET
    suspend fun getCsvImportStatusDirect(
        @retrofit2.http.Url url: String,
        @Header("Authorization") token: String
    ): Response<ch.brickinventoryapp.data.model.CsvImportStatus>

    // ── Anleitungen: hinzufügen und entfernen ──
    //
    // Der Server nimmt nur PDF, JPG und PNG an und leitet die Dateiendung aus dem
    // gemeldeten Typ ab — deshalb kommt der Typ aus der Dateiauswahl und wird nicht
    // geraten.
    @Multipart
    @POST("api/v1/sets/{setNumber}/instructions/upload")
    suspend fun uploadAnleitung(
        @Path("setNumber") setNumber: String,
        @retrofit2.http.Part datei: okhttp3.MultipartBody.Part,
        @retrofit2.http.Part("description") beschreibung: okhttp3.RequestBody,
    ): Response<GenericResponse>

    @DELETE("api/v1/sets/{setNumber}/instructions/{instrId}")
    suspend fun deleteAnleitung(
        @Path("setNumber") setNumber: String,
        @Path("instrId") instrId: Int,
    ): Response<GenericResponse>

    /**
     * Nur der Name, aus dem gemeinsamen Katalog. Getrennt von getSetDetail: „Wie
     * heisst dieses Set?“ gibt es auch für fremde Sets, „was habe ich davon?“ nicht.
     */
    @GET("api/v1/sets/info/{setNumber}")
    suspend fun getSetInfo(
        @Path("setNumber") setNumber: String
    ): Response<ch.brickinventoryapp.data.model.SetInfoResponse>

    @GET("api/v1/sets/{setNumber}")
    suspend fun getSetDetail(
        @Path("setNumber") setNumber: String
    ): Response<SetDetailResponse>

    // ── Kontofilter (Haushalt) ──
    //
    // `accounts`: "all" (Vorgabe), "own", "subs" oder die ID eines Kontos. Der Server
    // übersetzt ihn in Konto-IDs, damit Liste, Gesamtzahl, Kennzahlen und Summen aus
    // derselben Menge entstehen — im Gerät gefiltert stimmten die Zahlen nicht. null =
    // weglassen.
    @GET("api/v1/sets")
    /**
     * Galerie — auf dem Server gefiltert, sortiert und seitenweise, mit derselben
     * Regel wie die Webapp (utils/handlers.ts, getSets); eine eigene Suche im Gerät
     * kannte weder Jahr noch Sortierung.
     */
    suspend fun getSets(
        @Query("accounts") accounts: String? = null,
        @Query("search") search: String? = null,
        @Query("theme") theme: String? = null,
        @Query("sort") sort: String? = null,
        @Query("page") page: Int? = null,
        @Query("page_size") pageSize: Int? = null,
        /** Lagerort — eigener Parameter, nicht Teil der Suche (siehe Server). */
        @Query("storage") storage: String? = null
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

    /**
     * „Kann ich das bauen?" — welche Teile einer Liste schon da sind.
     *
     * Siehe die Begruendung fuer POST an BestandRequest (TeileMinifigModels.kt).
     */
    // ── Preisalarm ──────────────────────────────────────────────────────────
    //
    // Ohne `accounts=`: Ein Alarm gehoert genau EINEM Konto (siehe Preisalarm).

    /**
     * Was seit `since` ausgeloest hat. Ohne `since` liefert der Server nichts
     * und nur den Zeitpunkt — der erste Aufruf setzt die Marke.
     */
    @GET("api/v1/alerts/pending")
    suspend fun getPendingAlerts(
        @Query("since") since: String? = null,
    ): Response<PendingAlertsResponse>

    /**
     * Alle Alarme des Kontos für die Übersicht — dieselbe Antwortform wie die
     * Einzelroute, damit es ein Modell bleibt.
     */
    @GET("api/v1/alerts")
    suspend fun getAlleAlarme(): Response<PreisalarmeResponse>

    @GET("api/v1/sets/{setNumber}/alert")
    suspend fun getPreisalarme(
        @Path("setNumber") setNumber: String,
    ): Response<PreisalarmeResponse>

    @PUT("api/v1/sets/{setNumber}/alert")
    suspend fun setPreisalarm(
        @Path("setNumber") setNumber: String,
        @Body request: PreisalarmRequest,
    ): Response<PreisalarmResponse>

    @DELETE("api/v1/sets/{setNumber}/alert")
    suspend fun deletePreisalarm(
        @Path("setNumber") setNumber: String,
        @Query("condition") condition: String = "N",
    ): Response<PreisalarmResponse>

    // ── Lagerort je Set (für Teile und Figuren siehe TeileApi) ──

    @PUT("api/v1/sets/{setNumber}/storage")
    suspend fun setSetStorage(
        @Path("setNumber") setNumber: String,
        @Body request: LagerortRequest,
    ): Response<LagerortResponse>

    // ── Merkliste ──
    //
    // Der Zustand steht im Pfad, weil er zum Schlüssel gehört: Dasselbe Set neu und
    // gebraucht sind zwei Einträge.

    /**
     * Die Merkliste mit Suche, Zustand, Sortierung und Inhaber (`accounts`), dieselben
     * Namen wie bei getSets(). Alle optional, damit ein Aufruf ohne Filter dieselbe
     * Adresse ergibt.
     */
    @GET("api/v1/wanted")
    suspend fun getMerkliste(
        @Query("search") search: String? = null,
        @Query("condition") condition: String? = null,
        @Query("sort") sort: String? = null,
        @Query("accounts") accounts: String? = null,
    ): Response<MerklisteResponse>

    @POST("api/v1/wanted")
    suspend fun legeMerkpostenAn(
        @Body request: MerkpostenRequest,
    ): Response<MerkpostenAntwort>

    /**
     * Den Inhaber eines Merkpostens wechseln. PUT, weil nichts Neues entsteht; die
     * Regel (Aufnahmedatum bleibt, Alarm zieht mit) steht in utils/merkliste.ts.
     */
    @PUT("api/v1/wanted/{setNumber}/{condition}/inhaber")
    suspend fun verschiebeMerkposten(
        @Path("setNumber") setNumber: String,
        @Path("condition") condition: String,
        @Body request: MerkpostenInhaberRequest,
    ): Response<MerkpostenInhaberAntwort>

    @DELETE("api/v1/wanted/{setNumber}/{condition}")
    suspend fun loescheMerkposten(
        @Path("setNumber") setNumber: String,
        @Path("condition") condition: String,
        @Query("owner_user_id") ownerUserId: Int? = null,
    ): Response<GenericResponse>

    /**
     * Marktpreise eines Merkpostens, frisch geholt. Nicht /sets/{sn}/price: Die
     * antwortet 404, wenn einem das Set nicht gehört — bei einem Merkposten der
     * Regelfall.
     */
    @GET("api/v1/wanted/{setNumber}/preise")
    suspend fun getMerkpostenPreise(
        @Path("setNumber") setNumber: String,
    ): Response<MerkpostenPreiseResponse>

    @POST("api/v1/wanted/{setNumber}/{condition}/uebernehmen")
    suspend fun uebernimmMerkposten(
        @Path("setNumber") setNumber: String,
        @Path("condition") condition: String,
        @Body request: MerkpostenUebernahmeRequest,
    ): Response<MerkpostenUebernahmeResponse>

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

    @GET("api/v1/sets/exists/{setNumber}")
    suspend fun getSetExists(
        @Path("setNumber") setNumber: String
    ): Response<ch.brickinventoryapp.data.model.SetExistsResponse>

    @GET("api/v1/sets/barcode/{barcode}")
    suspend fun getBarcodeSet(
        @Path("barcode") barcode: String
    ): Response<BarcodeResponse>

    /**
     * Set oder einzelne Kaufpreise in ein anderes Konto verschieben; `acquisition_ids`
     * leer = das ganze Set. Was mitwandert, entscheidet der Server (utils/setMove.ts).
     */
    @POST("api/v1/sets/{setNumber}/move")
    suspend fun moveSet(
        @Path("setNumber") setNumber: String,
        @Body body: MoveSetRequest
    ): Response<MoveSetResponse>

    @POST("api/v1/admin/trigger-csv-sync")
    suspend fun triggerCsvSync(): Response<GenericAdminResponse>

    @POST("api/v1/admin/reimport-instructions")
    suspend fun reimportInstructions(): Response<GenericAdminResponse>
}

/** Teile und Figuren, Farben, Lagerorte, Standard-Zustand (TeileRepository). */
interface TeileApi : BestandsInhaltApi {

    // ── In welchen Sets steckt dieses Teil / diese Figur? ──
    //
    // Beide Adressen beantwortet dieselbe Funktion (verwendendeSets), deshalb ein
    // Modell. `accounts` ist das Blickfeld wie sonst, damit der Dialog dasselbe sagt
    // wie die Liste, aus der man kommt.
    @GET("api/v1/parts/{partNumber}/{colorId}/sets")
    suspend fun getSetsMitTeil(
        @Path("partNumber") partNumber: String,
        @Path("colorId") colorId: Int,
        @Query("accounts") accounts: String? = null,
    ): Response<VerwendendeSetsResponse>

    @GET("api/v1/minifigs/{figNumber}/sets")
    suspend fun getSetsMitFigur(
        @Path("figNumber") figNumber: String,
        @Query("accounts") accounts: String? = null,
    ): Response<VerwendendeSetsResponse>

    @GET("api/v1/parts/stats")
    suspend fun getPartsStats(
        @Query("accounts") accounts: String? = null
    ): Response<PartsStatsResponse>

    @GET("api/v1/parts/brick-colors")
    suspend fun getBrickColors(): Response<BrickColorsResponse>

    /**
     * Die Filterliste Farbe — welche Farben im Bestand vorkommen, mit Anzahl. Nicht
     * `brick-colors`: Das ist der ganze Farbkatalog für die Auswahl beim Erfassen.
     */
    @GET("api/v1/parts/colors")
    suspend fun getPartsFilterColors(
        @Query("accounts") accounts: String? = null
    ): Response<PartsFilterColorsResponse>

    /** Die Filterliste Kategorie — dieselbe Quelle wie in der Webapp. */
    @GET("api/v1/parts/categories")
    suspend fun getPartsCategories(
        @Query("accounts") accounts: String? = null
    ): Response<PartsCategoriesResponse>

    /**
     * Die Farbe eines manuell erfassten Teils ändern: alte Farbe im Pfad (sie ist Teil
     * der Kennung der Zeile), neue im Rumpf. `owner` ist der Besitzer der Karte, nicht
     * der Betrachter — ohne ihn schriebe der Server in die Zeile des Aufrufers.
     */
    @PUT("api/v1/parts/{partNumber}/{colorId}/color")
    suspend fun setPartColor(
        @Path("partNumber") partNumber: String,
        @Path("colorId") colorId: Int,
        @Body request: TeilFarbeRequest,
        @Query("owner") owner: Int? = null,
    ): Response<TeilFarbeResponse>

    // ── Lagerort ────────────────────────────────────────────────────────────
    //
    // Setzen trifft ALLE Zeilen des Teil-Farb-Paares bzw. des Sets im
    // Schreibbereich: Dasselbe Teil steckt in mehreren Sets, und wer „Kiste 3"
    // eintraegt, meint das Teil, nicht eine seiner Zeilen.

    @PUT("api/v1/parts/{partNumber}/{colorId}/storage")
    suspend fun setPartStorage(
        @Path("partNumber") partNumber: String,
        @Path("colorId") colorId: Int,
        @Body request: LagerortRequest,
    ): Response<LagerortResponse>

    // Seit Migration 0024 traegt auch eine Minifigur einen Lagerort. Eigene
    // Adresse, weil sie keine Farbe hat — sonst muesste die Route eine 0
    // mitschleppen, die nichts bedeutet.
    @PUT("api/v1/minifigs/{figNumber}/storage")
    suspend fun setFigStorage(
        @Path("figNumber") figNumber: String,
        @Body request: LagerortRequest,
    ): Response<LagerortResponse>

    // ── Der Vorrat an Lagerorten ──
    //
    // Getrennt von getLagerorte(): Dort steht, was belegt ist (Filter), hier, was zur
    // Wahl steht — ein neuer Ort ist wählbar und leer. `owner`: wessen Liste, beim Set
    // des Enkels die seine.

    @GET("api/v1/storage/locations")
    suspend fun getLagerortVorrat(
        @Query("owner") owner: String? = null,
    ): Response<LagerortVorratResponse>

    @POST("api/v1/storage/locations")
    suspend fun legeLagerortAn(
        @Body request: LagerortNameRequest,
    ): Response<LagerortEintragResponse>

    @PUT("api/v1/storage/locations/{id}")
    suspend fun benenneLagerortUm(
        @Path("id") id: Int,
        @Body request: LagerortNameRequest,
    ): Response<LagerortEintragResponse>

    @DELETE("api/v1/storage/locations/{id}")
    suspend fun loescheLagerort(
        @Path("id") id: Int,
    ): Response<LagerortResponse>

    // Der Stern: der Lagerort, der beim Erfassen schon vorausgewählt ist.
    // EIN Endpunkt fuer setzen und abschalten (id = null), weil es eine
    // Einstellung mit genau einem Wert ist. Gelesen wird sie nicht hier,
    // sondern als Feld `vorgabe` der Vorratsantwort darueber.
    @PUT("api/v1/storage/default")
    suspend fun setzeLagerortVorgabe(
        @Body request: LagerortVorgabeRequest,
    ): Response<LagerortVorgabeResponse>

    /** Welche Lagerorte es gibt und was darin liegt — Sets UND Teile. */
    @GET("api/v1/storage")
    suspend fun getLagerorte(
        @Query("accounts") accounts: String? = null,
    ): Response<LagerorteResponse>

    @POST("api/v1/parts/owned")
    suspend fun getOwnedParts(
        @Body request: BestandRequest,
        @Query("accounts") accounts: String? = null,
    ): Response<BestandResponse>

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
        @Body request: UpdateManualItemRequest,
        // Wessen Karte gemeint war — siehe deletePart.
        @Query("owner") owner: Int? = null
    ): Response<GenericResponse>

    @DELETE("api/v1/parts/{partNumber}/{colorId}")
    suspend fun deletePart(
        @Path("partNumber") partNumber: String,
        @Path("colorId") colorId: Int,
        // Wessen Karte gemeint war. null = eigenes Konto (Verhalten wie
        // bisher); ob ein fremdes erlaubt ist, entscheidet der Server.
        @Query("owner") owner: Int? = null
    ): Response<GenericResponse>

    @PUT("api/v1/minifigs/{figNumber}")
    suspend fun updateMinifig(
        @Path("figNumber") figNumber: String,
        @Body request: UpdateManualItemRequest,
        // Wessen Karte gemeint war — siehe deletePart.
        @Query("owner") owner: Int? = null
    ): Response<GenericResponse>

    @DELETE("api/v1/minifigs/{figNumber}")
    suspend fun deleteMinifig(
        @Path("figNumber") figNumber: String,
        // Wie bei deletePart: null = eigenes Konto.
        @Query("owner") owner: Int? = null
    ): Response<GenericResponse>

    /**
     * Die manuell erfassten Teile, mit Suchtext und Lagerort: Der Bildschirm hat ein
     * Suchfeld über manuellen und Set-Teilen, und beide sollen ihm folgen. Gefiltert
     * wird am Server (utils/handlers/parts.ts); ohne Parameter kommt alles.
     */
    @GET("api/v1/parts/manual")
    suspend fun getManualParts(
        @Query("accounts") accounts: String? = null,
        @Query("search") search: String? = null,
        @Query("storage") storage: String? = null
    ): Response<ch.brickinventoryapp.data.model.ManualPartsResponse>

    /**
     * Die manuell erfassten Figuren, mit Suchtext. Ohne Lagerort, weil es den Filter
     * bei den Minifiguren in keiner Oberfläche gibt.
     */
    @GET("api/v1/minifigs/manual")
    suspend fun getManualMinifigs(
        @Query("accounts") accounts: String? = null,
        @Query("search") search: String? = null
    ): Response<ch.brickinventoryapp.data.model.ManualFigsResponse>

    @GET("api/v1/minifigs/stats")
    suspend fun getMinifigStats(
        @Query("accounts") accounts: String? = null
    ): Response<ch.brickinventoryapp.data.model.MinifigStatsResponse>

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
}

/** Käufe je Set, Teil und Figur sowie der Haushalt (HaushaltRepository). */
interface HaushaltApi {

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

    @POST("api/v1/settings/household/former/dismiss")
    suspend fun verwerfeGetrenntesKonto(
        @Body body: Map<String, Int>
    ): Response<GenericResponse>

    /** Konten des Haushalts — für Kontofilter, Kontoauswahl und Verschieben. */
    @GET("api/v1/sets/household-members")
    suspend fun getHouseholdMembers(): Response<HouseholdMembersResponse>
}

/** Preise, Bewertungen, Gewinn und Verlust, Verlauf, Kennzahlen (FinanzenRepository). */
interface FinanzenApi {

    // Kein currency-Parameter: Die Währung bestimmt der Server aus der
    // Nutzereinstellung. Ein eigener Startwert traf den Cache der eingestellten
    // Währung nicht, und die Detailansicht zeigte keinen Marktpreis, wo Finanzen und
    // Kachel einen hatten.
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

    /**
     * Preisverlauf eines manuell erfassten Teils, je Zustand. Dieselbe Antwortform wie
     * beim Set, deshalb dasselbe Modell; die Set-Felder bleiben auf ihren Vorgaben.
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

    @GET("api/v1/finance/valuation")
    suspend fun getValuation(
        @Query("accounts") accounts: String? = null
    ): Response<ValuationResponse>

    @GET("api/v1/finance/portfolio-history")
    suspend fun getPortfolioHistory(
        @Query("period") period: String = "week",
        @Query("accounts") accounts: String? = null
    ): Response<PortfolioHistoryResponse>

    @GET("api/v1/stats")
    suspend fun getStats(
        @Query("accounts") accounts: String? = null
    ): Response<StatsResponse>

    @POST("api/v1/admin/trigger-price-job")
    suspend fun triggerPriceJob(): Response<GenericAdminResponse>
}

/** Gutscheine im eigenen Profil (GutscheineRepository). */
interface GutscheineApi {

    // ── Gutscheine (LEGO-Geschenkkarten im eigenen Profil) ──
    //
    // Dieselben Adressen wie die Webapp; requireToken nimmt Sitzung und Bearer an.
    // Gutscheine gehören streng ihrem Besitzer, deshalb kein `accounts`-Parameter.
    @GET("api/v1/vouchers")
    suspend fun getGutscheine(): Response<GutscheinListe>

    @POST("api/v1/vouchers")
    suspend fun legeGutscheinAn(@Body request: GutscheinRequest): Response<GutscheinAntwort>

    @PUT("api/v1/vouchers/{id}")
    suspend fun aendereGutschein(
        @Path("id") id: Int,
        @Body request: GutscheinRequest,
    ): Response<GutscheinAntwort>

    @DELETE("api/v1/vouchers/{id}")
    suspend fun loescheGutschein(@Path("id") id: Int): Response<GenericResponse>

    /**
     * Einen Gutschein aus seinem PDF anlegen. Mitgeschickte Werte gewinnen gegen das
     * Gelesene; reicht das PDF nicht, antwortet der Server mit 422 und dem, was er
     * lesen konnte. Die Teile sind optional, weil ein leeres Feld das Gelesene
     * überschriebe. Enthält die Datei mehrere Gutscheine, antwortet dieselbe Route mit
     * `mehrere`.
     */
    @Multipart
    @POST("api/v1/vouchers/pdf")
    suspend fun ladeGutscheinPdfHoch(
        @retrofit2.http.Part datei: okhttp3.MultipartBody.Part,
        @retrofit2.http.Part("number") nummer: okhttp3.RequestBody? = null,
        @retrofit2.http.Part("pin") pin: okhttp3.RequestBody? = null,
        @retrofit2.http.Part("amount") betrag: okhttp3.RequestBody? = null,
        @retrofit2.http.Part("currency") waehrung: okhttp3.RequestBody? = null,
    ): Response<GutscheinAntwort>

    /**
     * Das Guthaben einer Karte bei LEGO abfragen und speichern. Kein Rumpf: Nummer und
     * PIN liegen schon auf dem Server. Keine Methode für alle Karten — der Server
     * erlaubt eine Abfrage je 30 Sekunden, die Oberfläche taktet sich selbst durch
     * diese Route.
     */
    @POST("api/v1/vouchers/{id}/guthaben")
    suspend fun frageGuthabenAb(@Path("id") id: Int): Response<GuthabenAntwort>

    // Kein `GET /vouchers/export/pdf`: Der Export ist eine Datei zum Behalten, und die
    // App kann Dateien nicht speichern oder weitergeben (begründet in
    // test/webapp-endpunkte.test.js, NUR_WEB).

    // Eine Methode fuer `GET /vouchers/{id}/pdf` steht hier mit Absicht NICHT:
    // Das PDF holt der PdfViewerScreen selbst ueber seine Adresse, mit dem
    // angemeldeten Client der App. Siehe gutscheinPdfAdresse() in
    // ui/viewmodel/GutscheinAdressen.kt.
}
