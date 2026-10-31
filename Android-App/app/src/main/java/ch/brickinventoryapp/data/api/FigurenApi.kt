package ch.brickinventoryapp.data.api

import ch.brickinventoryapp.data.model.*
import retrofit2.Response
import retrofit2.http.*

/**
 * Die Figurenliste abfragen — für den Figuren-Reiter und den Inhalt eines Sets.
 */
interface FigurenAbfrageApi {

    @GET("api/v1/minifigs")
    suspend fun getMinifigs(
        @Query("source") source: String? = null,
        @Query("set_number") setNumber: String? = null,
        @Query("accounts") accounts: String? = null,
        @Query("search") search: String? = null
    ): Response<MinifigsResponse>
}

/**
 * Minifiguren: manuell erfasste Figuren, Kennzahlen, Lagerort (FigurenRepository).
 */
interface FigurenApi : FigurenAbfrageApi {

    @GET("api/v1/minifigs/{figNumber}/sets")
    suspend fun getSetsMitFigur(
        @Path("figNumber") figNumber: String,
        @Query("accounts") accounts: String? = null,
    ): Response<VerwendendeSetsResponse>

    // Seit Migration 0024 traegt auch eine Minifigur einen Lagerort. Eigene
    // Adresse, weil sie keine Farbe hat — sonst muesste die Route eine 0
    // mitschleppen, die nichts bedeutet.
    @PUT("api/v1/minifigs/{figNumber}/storage")
    suspend fun setFigStorage(
        @Path("figNumber") figNumber: String,
        @Body request: LagerortRequest,
    ): Response<LagerortResponse>

    @POST("api/v1/minifigs")
    suspend fun addMinifig(
        @Body request: AddMinifigRequest
    ): Response<AddMinifigResponse>

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
}
