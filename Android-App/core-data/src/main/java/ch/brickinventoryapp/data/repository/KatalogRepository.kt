package ch.brickinventoryapp.data.repository

import ch.brickinventoryapp.data.api.KatalogApi
import ch.brickinventoryapp.data.cache.ResponseCache
import ch.brickinventoryapp.data.model.*
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.RequestBody.Companion.toRequestBody
import kotlinx.serialization.decodeFromString
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Der Set-Katalog des Servers. Erreichbar über `repo.katalog.…`.
 */
@Singleton
class KatalogRepository @Inject constructor(
    api: KatalogApi,
    cache: ResponseCache,
) : RepoBasis<KatalogApi>(api, cache) {

    suspend fun getCatalogMeta(): Result<CatalogMetaResponse> =
        cached("catalog-meta", CatalogMetaResponse.serializer()) { safeCall { api.getCatalogMeta() } }

    suspend fun getCatalogSets(
        q: String? = null, themeId: Int? = null, yearFrom: Int? = null, yearTo: Int? = null,
        sort: String = "year_desc", page: Int = 1, limit: Int = 60
    ): Result<CatalogSetsResponse> = safeCall { api.getCatalogSets(q, themeId, yearFrom, yearTo, sort, page, limit) }

    suspend fun getCatalogSetDetail(setNumber: String): Result<CatalogSetDetailResponse> =
        safeCall { api.getCatalogSetDetail(setNumber) }

    /**
     * Jahresverteilung zu den aktuellen Filtern — die Zahlen, aus denen die
     * Leiste ihr Etikett rechnet. Einmal je Listenaufbau, nicht beim Rollen.
     */
    suspend fun getCatalogYearVerteilung(
        q: String? = null, themeId: Int? = null, sort: String = "year_desc"
    ): Result<ch.brickinventoryapp.data.model.CatalogYearVerteilungResponse> =
        safeCall { api.getCatalogYearVerteilung(q, themeId, sort) }
}
