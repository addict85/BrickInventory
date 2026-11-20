package ch.brickinventoryapp.data.repository

import ch.brickinventoryapp.model.domain.JahrAnzahlAnsicht
import ch.brickinventoryapp.model.domain.CatalogDetailView
import ch.brickinventoryapp.model.domain.CatalogMetaView
import ch.brickinventoryapp.model.domain.CatalogPageView

import ch.brickinventoryapp.model.domain.Katalogsortierung

/**
 * Der Set-Katalog des Servers.
 * Eine Schnittstelle, damit ViewModels und Tests nicht an der Umsetzung mit
 * Retrofit und Ablage hängen (KatalogRepositoryImpl).
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
 * Seitengrösse des Katalogs. Muss zur Rechnung des Servers passen: Der
 * Jahres-Sprung liefert `page` für genau diese Grösse, und aus `offset` leitet
 * die Ansicht die Seite selbst ab.
 */
const val CATALOG_PAGE_SIZE = 60
