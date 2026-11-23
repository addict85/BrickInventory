package ch.brickinventoryapp.data.api

import ch.brickinventoryapp.contract.ApiLimitsResponse
import ch.brickinventoryapp.contract.BricksetQueueResponse
import ch.brickinventoryapp.contract.CacheStatsResponse
import ch.brickinventoryapp.contract.CacheTtlResponse
import ch.brickinventoryapp.contract.CsvImportResult
import ch.brickinventoryapp.contract.GenericAdminResponse
import ch.brickinventoryapp.contract.JobChange
import ch.brickinventoryapp.contract.JobKindDrain
import ch.brickinventoryapp.contract.JobKindStart
import ch.brickinventoryapp.contract.JobQueueResponse
import ch.brickinventoryapp.contract.JobsResponse
import ch.brickinventoryapp.contract.LogResponse
import ch.brickinventoryapp.contract.StartupStatus
import retrofit2.Response
import retrofit2.http.Body
import retrofit2.http.DELETE
import retrofit2.http.GET
import retrofit2.http.Multipart
import retrofit2.http.POST
import retrofit2.http.PUT
import retrofit2.http.Part
import retrofit2.http.Path
import retrofit2.http.Query

/**
 * Operation of the server and data maintenance: CSV import, log, startup state,
 * background work, caches, quotas, global defaults (ManagementRepository).
 * Much of it only for admins; the server checks that, not the app.
 */
interface ManagementApi {

    // ── CSV import: the same addresses as in the web app ──
    //
    // `Part` is the annotation here, hence the type stands as `okhttp3.MultipartBody.Part`.
    // Three calls instead of one with a path parameter, because they are three routers.
    @Multipart
    @POST("api/v2/sets/import/csv")
    suspend fun importSetsCsv(@Part file: okhttp3.MultipartBody.Part): Response<CsvImportResult>

    @Multipart
    @POST("api/v2/parts/import/csv")
    suspend fun importPartsCsv(@Part file: okhttp3.MultipartBody.Part): Response<CsvImportResult>

    @Multipart
    @POST("api/v2/minifigs/import/csv")
    suspend fun importMinifigsCsv(@Part file: okhttp3.MultipartBody.Part): Response<CsvImportResult>

    // The wishlist does NOT lie under an own old router like sets,
    // parts and minifigures, but completely in `routes/api/wanted.ts` —
    // hence its import stands there and not under the wishlist routes.
    @Multipart
    @POST("api/v2/wanted/import/csv")
    suspend fun importWantedCsv(@Part file: okhttp3.MultipartBody.Part): Response<CsvImportResult>

    // Price alerts. The address lies under /alerts and not under
    // /sets/<nr>/alert because the file carries MANY sets — the single route
    // next to it sets exactly one alert.
    @Multipart
    @POST("api/v2/alerts/import/csv")
    suspend fun importAlertsCsv(@Part file: okhttp3.MultipartBody.Part): Response<CsvImportResult>

    // ── Server log (admins only) ──
    //
    // User management (/auth/users) is deliberately missing here: it belongs at the
    // computer, not on the phone.
    @GET("api/v2/admin/logs")
    suspend fun getLog(@Query("minutes") minutes: Int): Response<LogResponse>

    /**
     * Startup state of the server — without sign-in because it is needed before
     * anyone can sign in.
     */
    @GET("api/v2/startup-status")
    suspend fun getStartupStatus(): Response<StartupStatus>

    // ── Admin / Monitoring ────────────────────────────────────────────────────
    @GET("api/v2/admin/jobs")
    suspend fun getJobs(): Response<JobsResponse>

    /**
     * Schedule of a job: `{ name, time: "HH:MM" }` for daily jobs, `{ name:
     * "priceJob", minutes }` for the price job. A JsonObject because the server
     * distinguishes by the present field; the converter cannot write Map<String, Any>.
     */
    @POST("api/v2/admin/job-schedule")
    suspend fun setJobSchedule(@Body body: kotlinx.serialization.json.JsonObject): Response<GenericAdminResponse>

    /**
     * Queue missing catalog images. Not redownloadMissingImages: that fetches the
     * images of the stock.
     */
    @POST("api/v2/admin/catalog-images")
    suspend fun queueCatalogImages(): Response<GenericAdminResponse>

    /**
     * Switch the global design — admins only, so that it does not only work at the
     * computer.
     */
    @POST("api/v2/settings/admin/theme")
    suspend fun setAppTheme(@Body body: Map<String, String>): Response<GenericAdminResponse>

    @GET("api/v2/admin/brickset-queue")
    suspend fun getBricksetQueue(): Response<BricksetQueueResponse>

    @POST("api/v2/admin/brickset-queue/{setNumber}/retry")
    suspend fun retryBricksetEntry(
        @Path("setNumber") setNumber: String
    ): Response<GenericAdminResponse>

    @DELETE("api/v2/admin/brickset-queue/{setNumber}")
    suspend fun deleteBricksetEntry(
        @Path("setNumber") setNumber: String
    ): Response<GenericAdminResponse>

    @GET("api/v2/admin/cache-stats")
    suspend fun getCacheStats(): Response<CacheStatsResponse>

    @GET("api/v2/admin/cache-ttl")
    suspend fun getCacheTtl(): Response<CacheTtlResponse>

    @POST("api/v2/admin/cache-ttl")
    suspend fun setCacheTtl(
        @Body body: Map<String, String>
    ): Response<GenericAdminResponse>

    /**
     * Clear the price cache; with `all=true` also subsets and catalog. Global and
     * admins only: `price_cache` belongs to nobody, and every rebuild costs
     * requests from the shared daily quota.
     */
    @POST("api/v2/admin/cache-clear")
    suspend fun clearCache(
        @Body body: Map<String, Boolean> = emptyMap()
    ): Response<GenericAdminResponse>

    // The global default condition stands under getGlobalDefaultCondition()
    // (api/v2/settings/default-condition).

    @GET("api/v2/admin/api-limits")
    suspend fun getApiLimits(): Response<ApiLimitsResponse>

    @PUT("api/v2/admin/api-limits")
    suspend fun setApiLimits(
        @Body body: Map<String, Int>
    ): Response<GenericAdminResponse>

    @POST("api/v2/admin/redownload-missing-images")
    suspend fun redownloadMissingImages(): Response<GenericAdminResponse>

    /**
     * Background work from the job table; without [status] only „open“
     * and „running“. Only with full scope, otherwise 403.
     */
    @GET("api/v2/admin/job-queue")
    suspend fun getBackgroundJobs(
        @Query("status") status: String? = null,
        @Query("kind") kind: String? = null,
    ): Response<JobQueueResponse>

    /** Only for „open“ and „running“, otherwise 409. */
    @POST("api/v2/admin/job-queue/{id}/cancel")
    suspend fun requestJobCancel(@Path("id") id: String): Response<JobChange>

    /** Only for „error“ and „cancelled“, otherwise 409. */
    @POST("api/v2/admin/job-queue/{id}/retry")
    suspend fun repeatJob(@Path("id") id: String): Response<JobChange>

    @POST("api/v2/admin/job-queue/kind/{kind}/now")
    suspend fun startJobKind(@Path("kind") kind: String): Response<JobKindStart>

    @DELETE("api/v2/admin/job-queue/kind/{kind}")
    suspend fun emptyJobKind(@Path("kind") kind: String): Response<JobKindDrain>

    @POST("api/v2/admin/trigger-csv-sync")
    suspend fun triggerCsvSync(): Response<GenericAdminResponse>

    @POST("api/v2/admin/reimport-instructions")
    suspend fun reimportInstructions(): Response<GenericAdminResponse>

    @POST("api/v2/admin/trigger-price-job")
    suspend fun triggerPriceJob(): Response<GenericAdminResponse>

    // Admin-level global default
    @POST("api/v2/admin/default-condition")
    suspend fun setDefaultCondition(
        @Body body: Map<String, String>
    ): Response<GenericAdminResponse>
}
