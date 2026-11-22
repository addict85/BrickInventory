package ch.brickinventoryapp.data.api

import ch.brickinventoryapp.contract.AddPartRequest
import ch.brickinventoryapp.contract.AddPartResponse
import ch.brickinventoryapp.contract.BestandRequest
import ch.brickinventoryapp.contract.BestandResponse
import ch.brickinventoryapp.contract.BrickColorsResponse
import ch.brickinventoryapp.contract.GenericResponse
import ch.brickinventoryapp.contract.LagerortEintragResponse
import ch.brickinventoryapp.contract.LagerortNameRequest
import ch.brickinventoryapp.contract.LagerortRequest
import ch.brickinventoryapp.contract.LagerortResponse
import ch.brickinventoryapp.contract.LagerortVorgabeRequest
import ch.brickinventoryapp.contract.LagerortVorgabeResponse
import ch.brickinventoryapp.contract.LagerortVorratResponse
import ch.brickinventoryapp.contract.LagerorteResponse
import ch.brickinventoryapp.contract.ManualPartsResponse
import ch.brickinventoryapp.contract.PartsCategoriesResponse
import ch.brickinventoryapp.contract.PartsFilterColorsResponse
import ch.brickinventoryapp.contract.PartsResponse
import ch.brickinventoryapp.contract.PartsStatsResponse
import ch.brickinventoryapp.contract.TeilFarbeRequest
import ch.brickinventoryapp.contract.TeilFarbeResponse
import ch.brickinventoryapp.contract.UpdateManualItemRequest
import ch.brickinventoryapp.contract.VerwendendeSetsResponse
import ch.brickinventoryapp.model.data.SparePartChoice
import retrofit2.Response
import retrofit2.http.Body
import retrofit2.http.DELETE
import retrofit2.http.GET
import retrofit2.http.Header
import retrofit2.http.POST
import retrofit2.http.PUT
import retrofit2.http.Path
import retrofit2.http.Query

/**
 * Query the parts list — for the parts tab and the content of a set;
 * hence the parts and sets areas both inherit it.
 */
interface PartsQueryApi {

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
        // "0" = without spare parts, "1" = only spare parts, null = all.
        // The same three values as the web app's select field (parts-spare);
        // the server reads them in `utils/handlers/parts.ts`.
        @Query("spare") spare: String? = null,
        // "1" additionally fetches in which sets the part is. Costs the
        // server its own query — hence only in the table view,
        // just like in the web app (parts-view === 'table').
        @Query("with_sets") withSets: String? = null,
        /** Storage location — its own parameter, not part of the search (see server). */
        @Query("storage") storage: String? = null
    ): Response<PartsResponse>
}

/** Der Wert von `spare`; null heisst alle. */
internal fun SparePartChoice.asQuery(): String? = when (this) {
    SparePartChoice.ALL -> null
    SparePartChoice.WITHOUT -> "0"
    SparePartChoice.ONLY -> "1"
}

/** `with_sets=1` or no parameter. */
internal fun withSetsAsQuery(withSets: Boolean): String? = if (withSets) "1" else null

/**
 * Single parts, colors and storage locations (PartsRepository). Storage locations stand here
 * because their management lies in the parts tab; sets and figures only read them.
 */
interface PartsApi : PartsQueryApi {

    // ── In which sets is this part / this figure? ──
    //
    // The same function (verwendendeSets) answers both addresses, hence one
    // model. `accounts` is the view as usual, so that the dialog says the same
    // as the list one comes from.
    @GET("api/v1/parts/{partNumber}/{colorId}/sets")
    suspend fun getSetsWithPart(
        @Path("partNumber") partNumber: String,
        @Path("colorId") colorId: Int,
        @Query("accounts") accounts: String? = null,
    ): Response<VerwendendeSetsResponse>

    @GET("api/v1/parts/stats")
    suspend fun getPartsStats(
        @Query("accounts") accounts: String? = null
    ): Response<PartsStatsResponse>

    @GET("api/v1/parts/brick-colors")
    suspend fun getBrickColors(): Response<BrickColorsResponse>

    /**
     * The color filter list — which colors occur in the stock, with count. Not
     * `brick-colors`: that is the whole color catalog for the selection when adding.
     */
    @GET("api/v1/parts/colors")
    suspend fun getPartsFilterColors(
        @Query("accounts") accounts: String? = null
    ): Response<PartsFilterColorsResponse>

    /** The category filter list — the same source as in the web app. */
    @GET("api/v1/parts/categories")
    suspend fun getPartsCategories(
        @Query("accounts") accounts: String? = null
    ): Response<PartsCategoriesResponse>

    /**
     * Change the color of a manually added part: old color in the path (it is part
     * of the row's identifier), new one in the body. `owner` is the owner of the card, not
     * the viewer — without it the server would write into the caller's row.
     */
    @PUT("api/v1/parts/{partNumber}/{colorId}/color")
    suspend fun setPartColor(
        @Path("partNumber") partNumber: String,
        @Path("colorId") colorId: Int,
        @Body request: TeilFarbeRequest,
        @Query("owner") owner: Int? = null,
    ): Response<TeilFarbeResponse>

    // ── Storage location ────────────────────────────────────────────────────
    //
    // Setting hits ALL rows of the part-color pair or of the set in the
    // write scope: the same part is in several sets, and whoever enters „Kiste 3"
    // means the part, not one of its rows.

    @PUT("api/v1/parts/{partNumber}/{colorId}/storage")
    suspend fun setPartStorage(
        @Path("partNumber") partNumber: String,
        @Path("colorId") colorId: Int,
        @Body request: LagerortRequest,
    ): Response<LagerortResponse>

    // ── The supply of storage locations ──
    //
    // Separate from getLocations(): there stands what is occupied (filter), here what is
    // available for choice — a new location is selectable and empty. `owner`: whose list, for the set
    // of the grandchild theirs.

    @GET("api/v1/storage/locations")
    suspend fun getLocationStock(
        @Query("owner") owner: String? = null,
    ): Response<LagerortVorratResponse>

    @POST("api/v1/storage/locations")
    suspend fun createLocation(
        @Body request: LagerortNameRequest,
    ): Response<LagerortEintragResponse>

    @PUT("api/v1/storage/locations/{id}")
    suspend fun renameLocation(
        @Path("id") id: Int,
        @Body request: LagerortNameRequest,
    ): Response<LagerortEintragResponse>

    @DELETE("api/v1/storage/locations/{id}")
    suspend fun deleteLocation(
        @Path("id") id: Int,
    ): Response<LagerortResponse>

    // The star: the storage location that is already preselected when adding.
    // ONE endpoint for setting and switching off (id = null), because it is a
    // setting with exactly one value. It is not read here,
    // but as the field `default` of the supply response above.
    @PUT("api/v1/storage/default")
    suspend fun setLocationDefault(
        @Body request: LagerortVorgabeRequest,
    ): Response<LagerortVorgabeResponse>

    /** Which storage locations exist and what lies in them — sets AND parts. */
    @GET("api/v1/storage")
    suspend fun getLocations(
        @Query("accounts") accounts: String? = null,
    ): Response<LagerorteResponse>

    @POST("api/v1/parts/owned")
    suspend fun getOwnedParts(
        @Body request: BestandRequest,
        @Query("accounts") accounts: String? = null,
    ): Response<BestandResponse>

    @POST("api/v1/parts")
    suspend fun addPart(
        @Body request: AddPartRequest,
        @Header("Idempotency-Key") key: String? = null,
    ): Response<AddPartResponse>

    @PUT("api/v1/parts/{partNumber}/{colorId}")
    suspend fun updatePart(
        @Path("partNumber") partNumber: String,
        @Path("colorId") colorId: Int,
        @Body request: UpdateManualItemRequest,
        // Whose card was meant — see deletePart.
        @Query("owner") owner: Int? = null,
        @Header("Idempotency-Key") key: String? = null,
    ): Response<GenericResponse>

    @DELETE("api/v1/parts/{partNumber}/{colorId}")
    suspend fun deletePart(
        @Path("partNumber") partNumber: String,
        @Path("colorId") colorId: Int,
        // Whose card was meant. null = own account (behavior as
        // before); whether a foreign one is allowed is decided by the server.
        @Query("owner") owner: Int? = null,
        @Header("Idempotency-Key") key: String? = null,
    ): Response<GenericResponse>

    /**
     * The manually added parts, with search text and storage location: the screen has a
     * search field over manual and set parts, and both should follow it. Filtering
     * happens on the server (`utils/handlers/parts.ts`); without parameters everything comes.
     */
    @GET("api/v1/parts/manual")
    suspend fun getManualParts(
        @Query("accounts") accounts: String? = null,
        @Query("search") search: String? = null,
        @Query("storage") storage: String? = null
    ): Response<ManualPartsResponse>
}
