package ch.brickinventoryapp.parts.ui.viewmodel

import ch.brickinventoryapp.model.domain.Kategoriewahl
import ch.brickinventoryapp.model.domain.ColorPicker
import ch.brickinventoryapp.parts.ui.Teilefilter
import ch.brickinventoryapp.model.domain.Figurenerfassung
import ch.brickinventoryapp.model.domain.Teilerfassung
import ch.brickinventoryapp.model.domain.Zustand
import ch.brickinventoryapp.model.data.ScopeFilter
import ch.brickinventoryapp.model.domain.KEINE_FARBE
import ch.brickinventoryapp.model.data.Ersatzteilwahl
import ch.brickinventoryapp.model.ui.ListView
import ch.brickinventoryapp.parts.ui.SetItemUiState
import ch.brickinventoryapp.model.domain.Figurenordnung
import ch.brickinventoryapp.state.ui.viewmodel.Filterwahl
import kotlinx.coroutines.flow.StateFlow

/**
 * What the screens can trigger. They know only these interfaces, not the
 * ViewModels: this way they can be shown with a fixed state and a stub,
 * without Hilt and without a server.
 */
internal interface SetItemAktionen {
    /** [colorId] only counts for parts; a figure opens its own ViewModel. */
    fun openSetItem(nummer: String, colorId: Int = KEINE_FARBE)
    fun closeSetItem()
    fun setPartLocation(nummer: String, farbe: Int, ort: String)
}

/** A ViewModel with the detail "which sets is this in", as the list and detail read it. */
internal interface WithSetItem : SetItemAktionen, Filterwahl {
    val setItemState: StateFlow<SetItemUiState>
}

internal interface TeileAktionen : SetItemAktionen {
    fun loadParts(page: Int = 1, debounce: Boolean = false)
    fun loadPartsColors()
    fun setPartsQuery(q: String)
    fun setPartsSpare(wert: Ersatzteilwahl)
    fun setPartsView(wert: ListView)
    fun setPartsOrder(wert: Teilefilter.Order)
    fun setPartsColorFilter(wert: ColorPicker)
    fun setPartsCategoryFilter(wert: Kategoriewahl)
    fun setScope(view: ScopeFilter.View, value: String)
    fun setStorageFilter(view: ScopeFilter.View, value: String)
    fun loadLocationStock(besitzer: List<Int>)

    fun addPart(erfassung: Teilerfassung)
    fun updatePart(partNumber: String, colorId: Int, quantity: Int, unitPrice: Double?,
                   condition: Zustand? = null, owner: Int? = null)
    fun deletePart(partNumber: String, colorId: Int, owner: Int? = null)
    /** Delete with "Rückgängig"; without a list behind it to offer that, delete right away. */
    fun partDeleteReserve(partNumber: String, colorId: Int, owner: Int?, name: String) =
        deletePart(partNumber, colorId, owner)
    fun setzeTeilFarbe(partNumber: String, colorId: Int, neueFarbe: Int,
                       farbName: String? = null, farbHex: String? = null,
                       owner: Int? = null, onFertig: (Int) -> Unit = {})
}

internal interface FigurenAktionen : SetItemAktionen {
    fun loadMinifigs(debounce: Boolean = false)
    fun setMinifigsQuery(q: String)
    fun setMinifigsView(wert: ListView)
    fun setScope(view: ScopeFilter.View, value: String)

    fun addMinifig(erfassung: Figurenerfassung)
    fun updateMinifig(figNumber: String, quantity: Int, unitPrice: Double?, blFigNumber: String? = null,
                      condition: Zustand? = null, owner: Int? = null)
    fun deleteMinifig(figNumber: String, owner: Int? = null)
    /** Delete with "Rückgängig"; without a list behind it to offer that, delete right away. */
    fun minifigDeleteReserve(figNumber: String, owner: Int?, name: String) = deleteMinifig(figNumber, owner)
    fun setMinifigsOrder(wert: Figurenordnung) = Unit

    /** Figuren haben keinen eigenen Lagerort: Sie stecken in ihrem Set. */
    override fun setPartLocation(nummer: String, farbe: Int, ort: String) = Unit
}
