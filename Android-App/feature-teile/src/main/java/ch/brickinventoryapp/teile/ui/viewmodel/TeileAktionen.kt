package ch.brickinventoryapp.teile.ui.viewmodel

import ch.brickinventoryapp.model.data.ScopeFilter
import ch.brickinventoryapp.model.data.model.KEINE_FARBE
import ch.brickinventoryapp.model.data.Ersatzteilwahl
import ch.brickinventoryapp.model.ui.Listenansicht

/**
 * Was die Teile- und Figurenbildschirme auslösen können. Die Bildschirme kennen
 * nur diese Schnittstelle, nicht das ViewModel: So lassen sie sich mit einem
 * festen Zustand und einer Attrappe zeigen, ohne Hilt und ohne Server.
 */
interface TeileAktionen {
    fun loadParts(page: Int = 1, debounce: Boolean = false)
    fun loadMinifigs(debounce: Boolean = false)
    fun loadPartsColors()
    fun setPartsQuery(q: String)
    fun setPartsSpare(wert: Ersatzteilwahl)
    fun setPartsView(wert: Listenansicht)
    fun setPartsColorFilter(wert: String)
    fun setPartsCategoryFilter(wert: String)
    fun setMinifigsQuery(q: String)
    fun setMinifigsView(wert: Listenansicht)
    fun setScope(view: ScopeFilter.View, value: String)
    fun setLagerFilter(view: ScopeFilter.View, value: String)
    fun loadLagerortVorrat(besitzer: List<Int>)

    fun addPart(partNumber: String, colorId: Int = KEINE_FARBE, colorName: String? = null, colorHex: String? = null,
                quantity: Int = 1, unitPrice: Double? = null,
                condition: String? = null, ownerUserId: Int? = null,
                storage: String? = null)
    fun addMinifig(figNumber: String, blFigNumber: String? = null, quantity: Int = 1,
                   unitPrice: Double? = null, condition: String? = null, ownerUserId: Int? = null,
                   storage: String? = null)
    fun updatePart(partNumber: String, colorId: Int, quantity: Int, unitPrice: Double?,
                   condition: String? = null, owner: Int? = null)
    fun updateMinifig(figNumber: String, quantity: Int, unitPrice: Double?, blFigNumber: String? = null,
                      condition: String? = null, owner: Int? = null)
    fun deletePart(partNumber: String, colorId: Int, owner: Int? = null)
    fun deleteMinifig(figNumber: String, owner: Int? = null)
    fun setzeTeilFarbe(partNumber: String, colorId: Int, neueFarbe: Int,
                       farbName: String? = null, farbHex: String? = null,
                       owner: Int? = null, onFertig: (Int) -> Unit = {})

    fun oeffneSetItem(art: String, nummer: String, colorId: Int = KEINE_FARBE)
    fun schliesseSetItem()
    fun setzeTeilLagerort(nummer: String, farbe: Int, ort: String)
}
