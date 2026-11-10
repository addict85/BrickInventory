package ch.brickinventoryapp.katalog.ui.viewmodel

import ch.brickinventoryapp.model.fach.Katalogsortierung
/** Was der Katalog-Reiter auslöst; der Bildschirm kennt nur diese Schnittstelle. */
interface KatalogAktionen {
    fun loadCatalogMeta()
    fun loadCatalogSets()
    fun catalogSichtbar(ersteSeite: Int, letzteSeite: Int)
    fun scrollCatalogTo(nummer: Int)
    fun setCatalogScrollPos(index: Int, offset: Int)
    fun catalogScrollConsumed()
    fun setCatalogQuery(q: String)
    fun setCatalogTheme(themeId: Int?)
    fun setCatalogYear(year: Int?)
    fun setCatalogSort(sort: Katalogsortierung)
}
