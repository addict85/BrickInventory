package ch.brickinventoryapp.data.repository

import ch.brickinventoryapp.data.api.KatalogApi
import ch.brickinventoryapp.data.cache.ResponseCache
import ch.brickinventoryapp.data.model.*
import javax.inject.Inject
import javax.inject.Singleton
import ch.brickinventoryapp.data.model.CatalogYearVerteilungResponse

/**
 * Der Set-Katalog des Servers — über Retrofit; die gemeinsame Abruflogik steht in RepoBasis.kt.
 */
@Singleton
class KatalogRepositoryImpl @Inject constructor(
    api: KatalogApi,
    cache: ResponseCache,
) : RepoBasis<KatalogApi>(api, cache), KatalogRepository {

    override suspend fun getCatalogMeta(): Ergebnis<CatalogMetaResponse> =
        cached("catalog-meta", CatalogMetaResponse.serializer()) { safeCall { api.getCatalogMeta() } }

    override suspend fun getCatalogSets(
        q: String?, themeId: Int?, yearFrom: Int?, yearTo: Int?,
        sort: String, page: Int, limit: Int
    ): Ergebnis<CatalogSetsResponse> = safeCall { api.getCatalogSets(q, themeId, yearFrom, yearTo, sort, page, limit) }

    override suspend fun getCatalogSetDetail(setNumber: String): Ergebnis<CatalogSetDetailResponse> =
        safeCall { api.getCatalogSetDetail(setNumber) }

    /**
     * Jahresverteilung zu den aktuellen Filtern — die Zahlen, aus denen die
     * Leiste ihr Etikett rechnet. Einmal je Listenaufbau, nicht beim Rollen.
     */
    override suspend fun getCatalogYearVerteilung(
        q: String?, themeId: Int?, sort: String
    ): Ergebnis<CatalogYearVerteilungResponse> =
        safeCall { api.getCatalogYearVerteilung(q, themeId, sort) }
}
