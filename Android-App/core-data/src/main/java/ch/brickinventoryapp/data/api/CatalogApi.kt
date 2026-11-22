package ch.brickinventoryapp.data.api

import ch.brickinventoryapp.contract.CatalogMetaResponse
import ch.brickinventoryapp.contract.CatalogSetDetailResponse
import ch.brickinventoryapp.contract.CatalogSetsResponse
import retrofit2.Response
import retrofit2.http.GET
import retrofit2.http.Path
import retrofit2.http.Query
import ch.brickinventoryapp.contract.CatalogYearVerteilungResponse

/**
 * The server's set catalog: themes, list, detail, year distribution (CatalogRepository).
 */
interface CatalogApi {

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
        @Query("page_size") limit: Int = 60
    ): Response<CatalogSetsResponse>

    @GET("api/v1/catalog/sets/{setNumber}")
    suspend fun getCatalogSetDetail(@Path("setNumber") setNumber: String): Response<CatalogSetDetailResponse>

    @GET("api/v1/catalog/year-verteilung")
    suspend fun getCatalogYearDistribution(
        @Query("q") q: String? = null,
        @Query("theme_id") themeId: Int? = null,
        @Query("sort") sort: String? = null
    ): Response<CatalogYearVerteilungResponse>
}
