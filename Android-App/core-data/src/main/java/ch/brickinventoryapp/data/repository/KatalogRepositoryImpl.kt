package ch.brickinventoryapp.data.repository

import ch.brickinventoryapp.model.fach.Katalogsortierung
import ch.brickinventoryapp.data.api.KatalogApi
import ch.brickinventoryapp.data.cache.ResponseCache
import ch.brickinventoryapp.model.data.model.*
import javax.inject.Inject
import javax.inject.Singleton
import ch.brickinventoryapp.model.data.model.CatalogYearVerteilungResponse

/**
 * Der Set-Katalog des Servers — über Retrofit; die gemeinsame Abruflogik steht in Abruf.kt.
 */
@Singleton
class KatalogRepositoryImpl @Inject constructor(
    private val api: KatalogApi,
    private val cache: ResponseCache,
) : KatalogRepository {

    override suspend fun getCatalogMeta(): Ergebnis<CatalogMetaResponse> =
        cache.cached("catalog-meta", CatalogMetaResponse.serializer()) { sicherAufrufen { api.getCatalogMeta() } }

    override suspend fun getCatalogSets(
        q: String?, themeId: Int?, yearFrom: Int?, yearTo: Int?,
        sort: Katalogsortierung, page: Int, limit: Int
    ): Ergebnis<CatalogSetsResponse> = sicherAufrufen { api.getCatalogSets(q, themeId, yearFrom, yearTo, sort.kennung, page, limit) }

    override suspend fun getCatalogSetDetail(setNumber: String): Ergebnis<CatalogSetDetailResponse> =
        sicherAufrufen { api.getCatalogSetDetail(setNumber) }

    /**
     * Jahresverteilung zu den aktuellen Filtern — die Zahlen, aus denen die
     * Leiste ihr Etikett rechnet. Einmal je Listenaufbau, nicht beim Rollen.
     */
    override suspend fun getCatalogYearVerteilung(
        q: String?, themeId: Int?, sort: Katalogsortierung
    ): Ergebnis<CatalogYearVerteilungResponse> =
        sicherAufrufen { api.getCatalogYearVerteilung(q, themeId, sort.kennung) }
}
