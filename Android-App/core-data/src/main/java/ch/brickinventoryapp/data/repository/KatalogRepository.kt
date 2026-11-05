package ch.brickinventoryapp.data.repository

import ch.brickinventoryapp.data.model.*
import ch.brickinventoryapp.data.model.CatalogYearVerteilungResponse

/**
 * Der Set-Katalog des Servers.
 * Eine Schnittstelle, damit ViewModels und Tests nicht an der Umsetzung mit
 * Retrofit und Ablage hängen (KatalogRepositoryImpl).
 */
interface KatalogRepository {
    suspend fun getCatalogMeta(): Result<CatalogMetaResponse>

    suspend fun getCatalogSets(
        q: String? = null, themeId: Int? = null, yearFrom: Int? = null, yearTo: Int? = null,
        sort: String = "year_desc", page: Int = 1, limit: Int = 60
    ): Result<CatalogSetsResponse>

    suspend fun getCatalogSetDetail(setNumber: String): Result<CatalogSetDetailResponse>

    suspend fun getCatalogYearVerteilung(
        q: String? = null, themeId: Int? = null, sort: String = "year_desc"
    ): Result<CatalogYearVerteilungResponse>
}
