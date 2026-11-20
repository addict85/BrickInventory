package ch.brickinventoryapp.catalog.ui.viewmodel

import ch.brickinventoryapp.model.domain.Katalogsortierung
/** Was der Katalog-Reiter auslöst; der Bildschirm kennt nur diese Schnittstelle. */
interface KatalogAktionen {
    fun loadCatalogMeta()
    fun loadCatalogSets()
    fun catalogVisible(firstPage: Int, lastPage: Int)
    fun scrollCatalogTo(nummer: Int)
    fun catalogScrollConsumed()
    fun setCatalogQuery(q: String)
    fun setCatalogTheme(themeId: Int?)
    fun setCatalogYear(year: Int?)
    fun setCatalogSort(sort: Katalogsortierung)
}
