package ch.brickinventoryapp.data.api

import ch.brickinventoryapp.contract.AddMinifigRequest
import ch.brickinventoryapp.contract.AddMinifigResponse
import ch.brickinventoryapp.contract.GenericResponse
import ch.brickinventoryapp.contract.LagerortRequest
import ch.brickinventoryapp.contract.LagerortResponse
import ch.brickinventoryapp.contract.MinifigsResponse
import ch.brickinventoryapp.contract.UpdateManualItemRequest
import ch.brickinventoryapp.contract.VerwendendeSetsResponse
import retrofit2.Response
import retrofit2.http.Body
import retrofit2.http.DELETE
import retrofit2.http.GET
import retrofit2.http.Header
import retrofit2.http.POST
import retrofit2.http.PUT
import retrofit2.http.Path
import retrofit2.http.Query
import ch.brickinventoryapp.contract.ManualFigsResponse
import ch.brickinventoryapp.contract.MinifigStatsResponse

/**
 * Query the figure list — for the figures tab and the content of a set.
 */
interface MinifigsQueryApi {

    @GET("api/v1/minifigs")
    suspend fun getMinifigs(
        @Query("source") source: String? = null,
        @Query("set_number") setNumber: String? = null,
        @Query("accounts") accounts: String? = null,
        @Query("search") search: String? = null
    ): Response<MinifigsResponse>
}

/**
 * Minifiguren: manuell erfasste Figuren, Kennzahlen, Lagerort (MinifigsRepository).
 */
interface MinifigsApi : MinifigsQueryApi {

    @GET("api/v1/minifigs/{figNumber}/sets")
    suspend fun getSetsWithMinifig(
        @Path("figNumber") figNumber: String,
        @Query("accounts") accounts: String? = null,
    ): Response<VerwendendeSetsResponse>

    // Since migration 0024 a minifigure carries a storage location too. Own
    // address because it has no color — otherwise the route would have to drag along a 0
    // that means nothing.
    @PUT("api/v1/minifigs/{figNumber}/storage")
    suspend fun setFigStorage(
        @Path("figNumber") figNumber: String,
        @Body request: LagerortRequest,
    ): Response<LagerortResponse>

    @POST("api/v1/minifigs")
    suspend fun addMinifig(
        @Body request: AddMinifigRequest,
        @Header("Idempotency-Key") schluessel: String? = null,
    ): Response<AddMinifigResponse>

    @PUT("api/v1/minifigs/{figNumber}")
    suspend fun updateMinifig(
        @Path("figNumber") figNumber: String,
        @Body request: UpdateManualItemRequest,
        // Wessen Karte gemeint war — siehe deletePart.
        @Query("owner") owner: Int? = null,
        @Header("Idempotency-Key") schluessel: String? = null,
    ): Response<GenericResponse>

    @DELETE("api/v1/minifigs/{figNumber}")
    suspend fun deleteMinifig(
        @Path("figNumber") figNumber: String,
        // As with deletePart: null = own account.
        @Query("owner") owner: Int? = null,
        @Header("Idempotency-Key") schluessel: String? = null,
    ): Response<GenericResponse>

    /**
     * The manually added figures, with search text. Without storage location because the filter
     * does not exist for minifigures in any UI.
     */
    @GET("api/v1/minifigs/manual")
    suspend fun getManualMinifigs(
        @Query("accounts") accounts: String? = null,
        @Query("search") search: String? = null
    ): Response<ManualFigsResponse>

    @GET("api/v1/minifigs/stats")
    suspend fun getMinifigStats(
        @Query("accounts") accounts: String? = null
    ): Response<MinifigStatsResponse>
}
