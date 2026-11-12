package ch.brickinventoryapp.data.repository

import ch.brickinventoryapp.model.fach.Katalogsortierung
import ch.brickinventoryapp.model.data.model.CatalogMetaResponse
import ch.brickinventoryapp.model.data.model.CatalogSetDetailResponse
import ch.brickinventoryapp.model.data.model.CatalogSetsResponse
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
        sort: Katalogsortierung = Katalogsortierung.VORGABE, page: Int = 1, limit: Int = CATALOG_PAGE_SIZE
    ): Ergebnis<CatalogSetsResponse>

    suspend fun getCatalogSetDetail(setNumber: String): Ergebnis<CatalogSetDetailResponse>

    suspend fun getCatalogYearVerteilung(
        q: String? = null, themeId: Int? = null, sort: Katalogsortierung = Katalogsortierung.VORGABE
    ): Ergebnis<CatalogYearVerteilungResponse>
}

/**
 * Seitengrösse des Katalogs. Muss zur Rechnung des Servers passen: Der
 * Jahres-Sprung liefert `page` für genau diese Grösse, und aus `offset` leitet
 * die Ansicht die Seite selbst ab.
 */
const val CATALOG_PAGE_SIZE = 60
