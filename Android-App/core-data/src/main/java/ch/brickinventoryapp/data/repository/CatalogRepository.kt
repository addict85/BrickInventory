package ch.brickinventoryapp.data.repository

import ch.brickinventoryapp.model.domain.JahrAnzahlAnsicht
import ch.brickinventoryapp.model.domain.CatalogDetailView
import ch.brickinventoryapp.model.domain.CatalogMetaView
import ch.brickinventoryapp.model.domain.CatalogPageView

import ch.brickinventoryapp.model.domain.Katalogsortierung

/**
 * The server's set catalog.
 * An interface so that ViewModels and tests do not depend on the implementation with
 * Retrofit and store (KatalogRepositoryImpl).
 */
interface CatalogRepository {
    suspend fun getCatalogMeta(): Ergebnis<CatalogMetaView>

    suspend fun getCatalogSets(
        q: String? = null, themeId: Int? = null, yearFrom: Int? = null, yearTo: Int? = null,
        sort: Katalogsortierung = Katalogsortierung.DEFAULT, page: Int = 1, limit: Int = CATALOG_PAGE_SIZE
    ): Ergebnis<CatalogPageView>

    suspend fun getCatalogSetDetail(setNumber: String): Ergebnis<CatalogDetailView?>

    suspend fun getCatalogYearVerteilung(
        q: String? = null, themeId: Int? = null, sort: Katalogsortierung = Katalogsortierung.DEFAULT
    ): Ergebnis<List<JahrAnzahlAnsicht>>
}

/**
 * Page size of the catalog. Must match the server's calculation: the
 * year jump delivers `page` for exactly this size, and from `offset` the
 * view derives the page itself.
 */
const val CATALOG_PAGE_SIZE = 60
