package ch.brickinventoryapp.data.api

import ch.brickinventoryapp.data.model.*
import retrofit2.Response
import retrofit2.http.*

/**
 * Betrieb des Servers und Datenpflege: CSV-Import, Protokoll, Startzustand,
 * Hintergrundarbeiten, Caches, Kontingente, globale Vorgaben (VerwaltungRepository).
 * Vieles davon nur für Verwalter; der Server prüft das, nicht die App.
 */
interface VerwaltungApi {

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

    // ── Admin / Monitoring ────────────────────────────────────────────────────
    @GET("api/v1/admin/jobs")
    suspend fun getJobs(): Response<JobsResponse>

    /**
     * Zeitplan eines Jobs: `{ name, time: "HH:MM" }` für tägliche Jobs, `{ name:
     * "priceJob", minutes }` für den Preis-Job. Ein JsonObject, weil der Server am
     * vorhandenen Feld unterscheidet; Map<String, Any> kann der Wandler nicht schreiben.
     */
    @POST("api/v1/admin/job-schedule")
    suspend fun setJobSchedule(@Body body: kotlinx.serialization.json.JsonObject): Response<GenericAdminResponse>

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

    @POST("api/v1/admin/trigger-csv-sync")
    suspend fun triggerCsvSync(): Response<GenericAdminResponse>

    @POST("api/v1/admin/reimport-instructions")
    suspend fun reimportInstructions(): Response<GenericAdminResponse>

    @POST("api/v1/admin/trigger-price-job")
    suspend fun triggerPriceJob(): Response<GenericAdminResponse>

    // Admin-level global default
    @POST("api/v1/admin/default-condition")
    suspend fun setDefaultCondition(
        @Body body: Map<String, String>
    ): Response<GenericAdminResponse>
}
