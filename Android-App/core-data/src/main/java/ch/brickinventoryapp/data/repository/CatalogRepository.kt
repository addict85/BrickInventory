package ch.brickinventoryapp.data.repository

import ch.brickinventoryapp.model.domain.YearCountView
import ch.brickinventoryapp.model.domain.CatalogDetailView
import ch.brickinventoryapp.model.domain.CatalogMetaView
import ch.brickinventoryapp.model.domain.CatalogPageView

import ch.brickinventoryapp.model.domain.CatalogSort

/**
 * The server's set catalog.
 * An interface so that ViewModels and tests do not depend on the implementation with
 * Retrofit and store (CatalogRepositoryImpl).
 */
interface CatalogRepository {
    suspend fun getCatalogMeta(): Outcome<CatalogMetaView>

    suspend fun getCatalogSets(
        q: String? = null, themeId: Int? = null, yearFrom: Int? = null, yearTo: Int? = null,
        sort: CatalogSort = CatalogSort.DEFAULT, page: Int = 1, limit: Int = CATALOG_PAGE_SIZE
    ): Outcome<CatalogPageView>

    suspend fun getCatalogSetDetail(setNumber: String): Outcome<CatalogDetailView?>

    suspend fun getCatalogYearDistribution(
        q: String? = null, themeId: Int? = null, sort: CatalogSort = CatalogSort.DEFAULT
    ): Outcome<List<YearCountView>>
}

/**
 * Page size of the catalog. Must match the server's calculation: the
 * year jump delivers `page` for exactly this size, and from `offset` the
 * view derives the page itself.
 */
const val CATALOG_PAGE_SIZE = 60
