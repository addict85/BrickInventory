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
 * Was die Bildschirme auslösen können. Sie kennen nur diese Schnittstellen, nicht die
 * ViewModels: So lassen sie sich mit einem festen Zustand und einer Attrappe zeigen,
 * ohne Hilt und ohne Server.
 */
internal interface SetItemAktionen {
    /** [colorId] zählt nur bei Teilen; eine Figur öffnet ihr eigenes ViewModel. */
    fun openSetItem(nummer: String, colorId: Int = KEINE_FARBE)
    fun closeSetItem()
    fun setPartLocation(nummer: String, farbe: Int, ort: String)
}

/** Ein ViewModel mit dem Detail „in welchen Sets steckt das“, wie es Liste und Detail lesen. */
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
    /** Löschen mit „Rückgängig“; ohne Liste dahinter, die es anbietet, gleich löschen. */
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
    /** Löschen mit „Rückgängig“; ohne Liste dahinter, die es anbietet, gleich löschen. */
    fun minifigDeleteReserve(figNumber: String, owner: Int?, name: String) = deleteMinifig(figNumber, owner)
    fun setMinifigsOrder(wert: Figurenordnung) = Unit

    /** Figuren haben keinen eigenen Lagerort: Sie stecken in ihrem Set. */
    override fun setPartLocation(nummer: String, farbe: Int, ort: String) = Unit
}
