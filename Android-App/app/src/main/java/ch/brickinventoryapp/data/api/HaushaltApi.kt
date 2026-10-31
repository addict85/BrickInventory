package ch.brickinventoryapp.data.api

import ch.brickinventoryapp.data.model.*
import retrofit2.Response
import retrofit2.http.*

/**
 * Käufe je Set, Teil und Figur sowie der Haushalt (HaushaltRepository).
 */
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
