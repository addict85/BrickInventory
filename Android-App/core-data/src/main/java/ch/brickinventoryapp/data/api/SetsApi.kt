package ch.brickinventoryapp.data.api

import ch.brickinventoryapp.contract.AddSetRequest
import ch.brickinventoryapp.contract.AddSetResponse
import ch.brickinventoryapp.contract.BarcodeResponse
import ch.brickinventoryapp.contract.CsvImportStatus
import ch.brickinventoryapp.contract.GenericAdminResponse
import ch.brickinventoryapp.contract.GenericResponse
import ch.brickinventoryapp.contract.LagerortRequest
import ch.brickinventoryapp.contract.LagerortResponse
import ch.brickinventoryapp.contract.MengeGeaendert
import ch.brickinventoryapp.contract.MerklisteResponse
import ch.brickinventoryapp.contract.MerkpostenAntwort
import ch.brickinventoryapp.contract.MerkpostenInhaberAntwort
import ch.brickinventoryapp.contract.MerkpostenInhaberRequest
import ch.brickinventoryapp.contract.MerkpostenPreiseResponse
import ch.brickinventoryapp.contract.MerkpostenRequest
import ch.brickinventoryapp.contract.MerkpostenUebernahmeRequest
import ch.brickinventoryapp.contract.MerkpostenUebernahmeResponse
import ch.brickinventoryapp.contract.MinifigsResponse
import ch.brickinventoryapp.contract.MoveSetRequest
import ch.brickinventoryapp.contract.MoveSetResponse
import ch.brickinventoryapp.contract.PartsResponse
import ch.brickinventoryapp.contract.PdfAuftragAnfrage
import ch.brickinventoryapp.contract.PdfAuftragAntwort
import ch.brickinventoryapp.contract.PdfAuftragStand
import ch.brickinventoryapp.contract.PendingAlertsResponse
import ch.brickinventoryapp.contract.PreisalarmRequest
import ch.brickinventoryapp.contract.PreisalarmResponse
import ch.brickinventoryapp.contract.PreisalarmeResponse
import ch.brickinventoryapp.contract.SetExistsResponse
import ch.brickinventoryapp.contract.SetInfoResponse
import ch.brickinventoryapp.contract.SetResponse
import ch.brickinventoryapp.contract.SetsResponse
import ch.brickinventoryapp.contract.UpdateQuantityRequest
import retrofit2.Response
import retrofit2.http.Body
import retrofit2.http.DELETE
import retrofit2.http.GET
import retrofit2.http.Header
import retrofit2.http.Multipart
import retrofit2.http.POST
import retrofit2.http.PUT
import retrofit2.http.Path
import retrofit2.http.Query

/**
 * Sets, instructions, price alerts, storage location per set, wishlist, PDF export and
 * parts lists (SetsRepository). Inherits the queries of parts and figures because
 * the content of a set comes via the same addresses.
 */
interface SetsApi : PartsQueryApi, MinifigsQueryApi {

    // Moved to /api/v1: since the merge there is only ONE
    // address space. The router behind it is the same as before — only the address
    // has changed (see `server.ts`).
    @GET("api/v1/sets/import/csv/status")
    suspend fun getCsvImportStatus(): Response<CsvImportStatus>

    /**
     * Cancel a running CSV import. The server only records `cancelled`; already
     * created sets stay — cancelled means „no further from here“, not
     * „undo“, as in the web app.
     */
    @POST("api/v1/sets/import/csv/cancel")
    suspend fun cancelCsvImport(): Response<GenericAdminResponse>

    // ── Instructions: add and remove ──
    //
    // The server accepts only PDF, JPG and PNG and derives the file extension from the
    // reported type — hence the type comes from the file picker and is not
    // guessed.
    @Multipart
    @POST("api/v1/sets/{setNumber}/instructions/upload")
    suspend fun uploadInstruction(
        @Path("setNumber") setNumber: String,
        @retrofit2.http.Part file: okhttp3.MultipartBody.Part,
        @retrofit2.http.Part("description") description: okhttp3.RequestBody,
    ): Response<GenericResponse>

    @DELETE("api/v1/sets/{setNumber}/instructions/{instrId}")
    suspend fun deleteInstructionNow(
        @Path("setNumber") setNumber: String,
        @Path("instrId") instrId: Int,
    ): Response<GenericResponse>

    /**
     * Only the name, from the common catalog. Separate from getSetDetail: „What is
     * this set called?“ exists for foreign sets too, „what do I have of it?“ does not.
     */
    @GET("api/v1/sets/info/{setNumber}")
    suspend fun getSetInfo(
        @Path("setNumber") setNumber: String
    ): Response<SetInfoResponse>

    @GET("api/v1/sets/{setNumber}")
    suspend fun getSetDetail(
        @Path("setNumber") setNumber: String
    ): Response<SetResponse>

    // ── Account filter (household) ──
    //
    // `accounts`: "all" (default), "own", "subs" or the ID of an account. The server
    // translates it into account IDs so that list, total, key figures and sums arise from
    // the same set — filtered on the device the numbers did not match. null =
    // omit.
    @GET("api/v1/sets")
    /**
     * Gallery — filtered, sorted and paged on the server, with the same
     * rule as the web app (`utils/handlers.ts`, getSets); an own search on the device
     * knew neither year nor sorting.
     */
    suspend fun getSets(
        @Query("accounts") accounts: String? = null,
        @Query("search") search: String? = null,
        @Query("theme") theme: String? = null,
        @Query("sort") sort: String? = null,
        @Query("page") page: Int? = null,
        @Query("page_size") pageSize: Int? = null,
        /** Storage location — its own parameter, not part of the search (see server). */
        @Query("storage") storage: String? = null
    ): Response<SetsResponse>

    @GET("api/v1/sets/{setNumber}")
    suspend fun getSet(
        @Path("setNumber") setNumber: String
    ): Response<SetResponse>

    @POST("api/v1/sets")
    suspend fun addSet(
        @Body request: AddSetRequest,
        @Header("Idempotency-Key") key: String? = null,
    ): Response<AddSetResponse>

    @PUT("api/v1/sets/{setNumber}")
    suspend fun updateSetQuantity(
        @Path("setNumber") setNumber: String,
        @Body request: UpdateQuantityRequest,
        @Header("Idempotency-Key") key: String? = null,
    ): Response<MengeGeaendert>

    @DELETE("api/v1/sets/{setNumber}")
    suspend fun deleteSet(
        @Path("setNumber") setNumber: String
    ): Response<GenericResponse>

    /**
     * „Can I build this?" — which parts of a list are already there.
     *
     * POST although nothing is changed: over a thousand part-color pairs would give an address
     * that no proxy lets through.
     */
    // ── Preisalarm ──────────────────────────────────────────────────────────
    //
    // Without `accounts=`: an alert belongs to exactly ONE account (see the price alert).

    /**
     * What has triggered since `since`. Without `since` the server delivers nothing
     * but the point in time — the first call sets the mark.
     */
    @GET("api/v1/alerts/pending")
    suspend fun getPendingAlerts(
        @Query("since") since: String? = null,
    ): Response<PendingAlertsResponse>

    /**
     * All alerts of the account for the overview — the same response form as the
     * single route, so that it stays one model.
     */
    @GET("api/v1/alerts")
    suspend fun getAllAlerts(): Response<PreisalarmeResponse>

    @GET("api/v1/sets/{setNumber}/alert")
    suspend fun getPriceAlarms(
        @Path("setNumber") setNumber: String,
    ): Response<PreisalarmeResponse>

    @PUT("api/v1/sets/{setNumber}/alert")
    suspend fun setPriceAlarm(
        @Path("setNumber") setNumber: String,
        @Body request: PreisalarmRequest,
    ): Response<PreisalarmResponse>

    @DELETE("api/v1/sets/{setNumber}/alert")
    suspend fun deletePriceAlert(
        @Path("setNumber") setNumber: String,
        @Query("condition") condition: String = "N",
    ): Response<PreisalarmResponse>

    // ── Storage location per set (for parts and figures see PartsApi) ──

    @PUT("api/v1/sets/{setNumber}/storage")
    suspend fun setSetStorage(
        @Path("setNumber") setNumber: String,
        @Body request: LagerortRequest,
    ): Response<LagerortResponse>

    // ── Wishlist ──
    //
    // The condition stands in the path because it belongs to the key: the same set new and
    // used are two entries.

    /**
     * The wishlist with search, condition, sorting and owner (`accounts`), the same
     * names as for getSets(). All optional, so that a call without filters gives the same
     * address.
     */
    @GET("api/v1/wanted")
    suspend fun getWantedList(
        @Query("search") search: String? = null,
        @Query("condition") condition: String? = null,
        @Query("sort") sort: String? = null,
        @Query("accounts") accounts: String? = null,
    ): Response<MerklisteResponse>

    @POST("api/v1/wanted")
    suspend fun createWantedItem(
        @Body request: MerkpostenRequest,
        @Header("Idempotency-Key") key: String? = null,
    ): Response<MerkpostenAntwort>

    /**
     * Change the owner of a wishlist item. PUT because nothing new arises; the
     * rule (date added stays, alert moves along) stands in `utils/merkliste.ts`.
     */
    @PUT("api/v1/wanted/{setNumber}/{condition}/inhaber")
    suspend fun moveWantedItem(
        @Path("setNumber") setNumber: String,
        @Path("condition") condition: String,
        @Body request: MerkpostenInhaberRequest,
    ): Response<MerkpostenInhaberAntwort>

    @DELETE("api/v1/wanted/{setNumber}/{condition}")
    suspend fun deleteWantedItem(
        @Path("setNumber") setNumber: String,
        @Path("condition") condition: String,
        @Query("owner_user_id") ownerUserId: Int? = null,
        @Header("Idempotency-Key") key: String? = null,
    ): Response<GenericResponse>

    /**
     * Market prices of a wishlist item, freshly fetched. Not /sets/{sn}/price: that
     * answers 404 if the set does not belong to one — for a wishlist item the
     * normal case.
     */
    @GET("api/v1/wanted/{setNumber}/preise")
    suspend fun getWantedItemPrices(
        @Path("setNumber") setNumber: String,
    ): Response<MerkpostenPreiseResponse>

    @POST("api/v1/wanted/{setNumber}/{condition}/uebernehmen")
    suspend fun adoptWantedItem(
        @Path("setNumber") setNumber: String,
        @Path("condition") condition: String,
        @Body request: MerkpostenUebernahmeRequest,
    ): Response<MerkpostenUebernahmeResponse>

    @POST("api/v1/sets/partslist-pdf")
    suspend fun startPdfJob(
        @Body job: PdfAuftragAnfrage
    ): Response<PdfAuftragAntwort>

    @GET("api/v1/sets/partslist-pdf/status/{jobId}")
    suspend fun getPdfJobStatus(
        @Path("jobId") jobId: String
    ): Response<PdfAuftragStand>

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
    ): Response<SetExistsResponse>

    @GET("api/v1/sets/barcode/{barcode}")
    suspend fun getBarcodeSet(
        @Path("barcode") barcode: String
    ): Response<BarcodeResponse>

    /**
     * Move a set or individual purchase prices into another account; `acquisition_ids`
     * empty = the whole set. What moves along is decided by the server (`utils/setMove.ts`).
     */
    @POST("api/v1/sets/{setNumber}/move")
    suspend fun moveSet(
        @Path("setNumber") setNumber: String,
        @Body body: MoveSetRequest
    ): Response<MoveSetResponse>
}
