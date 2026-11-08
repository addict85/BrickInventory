package ch.brickinventoryapp.data.repository

import ch.brickinventoryapp.model.data.model.*
import ch.brickinventoryapp.model.data.model.CatalogYearVerteilungResponse

/**
 * Der Set-Katalog des Servers.
 * Eine Schnittstelle, damit ViewModels und Tests nicht an der Umsetzung mit
 * Retrofit und Ablage hängen (KatalogRepositoryImpl).
 */
interface KatalogRepository {
    suspend fun getCatalogMeta(): Ergebnis<CatalogMetaResponse>

    suspend fun getCatalogSets(
        q: String? = null, themeId: Int? = null, yearFrom: Int? = null, yearTo: Int? = null,
        sort: String = "year_desc", page: Int = 1, limit: Int = 60
    ): Ergebnis<CatalogSetsResponse>

    suspend fun getCatalogSetDetail(setNumber: String): Ergebnis<CatalogSetDetailResponse>

    suspend fun getCatalogYearVerteilung(
        q: String? = null, themeId: Int? = null, sort: String = "year_desc"
    ): Ergebnis<CatalogYearVerteilungResponse>
}
