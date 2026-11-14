package ch.brickinventoryapp.teile.ui.viewmodel

import ch.brickinventoryapp.model.fach.Postenart
import ch.brickinventoryapp.model.fach.Figurenerfassung
import ch.brickinventoryapp.model.fach.Teilerfassung
import ch.brickinventoryapp.model.fach.Zustand
import ch.brickinventoryapp.model.data.ScopeFilter
import ch.brickinventoryapp.model.fach.KEINE_FARBE
import ch.brickinventoryapp.model.data.Ersatzteilwahl
import ch.brickinventoryapp.model.ui.Listenansicht
import ch.brickinventoryapp.teile.ui.PartsUiState

/**
 * Was die Teile- und Figurenbildschirme auslösen können. Die Bildschirme kennen
 * nur diese Schnittstelle, nicht das ViewModel: So lassen sie sich mit einem
 * festen Zustand und einer Attrappe zeigen, ohne Hilt und ohne Server.
 */
internal interface TeileAktionen {
    fun loadParts(page: Int = 1, debounce: Boolean = false)
    fun loadMinifigs(debounce: Boolean = false)
    fun loadPartsColors()
    fun setPartsQuery(q: String)
    fun setPartsSpare(wert: Ersatzteilwahl)
    fun setPartsView(wert: Listenansicht)
    fun setPartsOrdnung(wert: PartsUiState.Ordnung)
    fun setPartsColorFilter(wert: String)
    fun setPartsCategoryFilter(wert: String)
    fun setMinifigsQuery(q: String)
    fun setMinifigsView(wert: Listenansicht)
    fun setScope(view: ScopeFilter.View, value: String)
    fun setLagerFilter(view: ScopeFilter.View, value: String)
    fun loadLagerortVorrat(besitzer: List<Int>)

    fun addPart(erfassung: Teilerfassung)
    fun addMinifig(erfassung: Figurenerfassung)
    fun updatePart(partNumber: String, colorId: Int, quantity: Int, unitPrice: Double?,
                   condition: Zustand? = null, owner: Int? = null)
    fun updateMinifig(figNumber: String, quantity: Int, unitPrice: Double?, blFigNumber: String? = null,
                      condition: Zustand? = null, owner: Int? = null)
    fun deletePart(partNumber: String, colorId: Int, owner: Int? = null)
    fun deleteMinifig(figNumber: String, owner: Int? = null)
    fun setzeTeilFarbe(partNumber: String, colorId: Int, neueFarbe: Int,
                       farbName: String? = null, farbHex: String? = null,
                       owner: Int? = null, onFertig: (Int) -> Unit = {})

    fun oeffneSetItem(art: Postenart, nummer: String, colorId: Int = KEINE_FARBE)
    fun schliesseSetItem()
    fun setzeTeilLagerort(nummer: String, farbe: Int, ort: String)
}
