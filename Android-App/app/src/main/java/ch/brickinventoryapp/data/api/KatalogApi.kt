package ch.brickinventoryapp.data.api

import ch.brickinventoryapp.data.model.*
import retrofit2.Response
import retrofit2.http.*

/**
 * Der Set-Katalog des Servers: Themen, Liste, Detail, Jahresverteilung (KatalogRepository).
 */
interface KatalogApi {

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

    @GET("api/v1/catalog/year-verteilung")
    suspend fun getCatalogYearVerteilung(
        @Query("q") q: String? = null,
        @Query("theme_id") themeId: Int? = null,
        @Query("sort") sort: String? = null
    ): Response<ch.brickinventoryapp.data.model.CatalogYearVerteilungResponse>
}
