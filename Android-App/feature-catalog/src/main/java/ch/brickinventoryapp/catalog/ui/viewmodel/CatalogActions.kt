package ch.brickinventoryapp.catalog.ui.viewmodel

import ch.brickinventoryapp.model.domain.CatalogSort
/** What the catalog tab triggers; the screen only knows this interface. */
interface CatalogActions {
    fun loadCatalogMeta()
    fun loadCatalogSets()
    fun catalogVisible(firstPage: Int, lastPage: Int)
    fun scrollCatalogTo(number: Int)
    fun catalogScrollConsumed()
    fun setCatalogQuery(q: String)
    fun setCatalogTheme(themeId: Int?)
    fun setCatalogYear(year: Int?)
    fun setCatalogSort(sort: CatalogSort)
}
