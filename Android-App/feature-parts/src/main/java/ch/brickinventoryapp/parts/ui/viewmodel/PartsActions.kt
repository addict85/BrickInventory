package ch.brickinventoryapp.parts.ui.viewmodel

import ch.brickinventoryapp.model.data.ScopeFilter
import ch.brickinventoryapp.model.data.SparePartChoice
import ch.brickinventoryapp.model.domain.CategoryChoice
import ch.brickinventoryapp.model.domain.ColorPicker
import ch.brickinventoryapp.model.domain.Condition
import ch.brickinventoryapp.model.domain.FigureEntry
import ch.brickinventoryapp.model.domain.FigureOrder
import ch.brickinventoryapp.model.domain.NO_COLOR
import ch.brickinventoryapp.model.domain.PartEntry
import ch.brickinventoryapp.model.ui.ListView
import ch.brickinventoryapp.parts.ui.PartsFilter
import ch.brickinventoryapp.parts.ui.SetItemUiState
import ch.brickinventoryapp.state.ui.viewmodel.FilterChoice
import kotlinx.coroutines.flow.StateFlow

/**
 * What the screens can trigger. They know only these interfaces, not the
 * ViewModels: this way they can be shown with a fixed state and a stub,
 * without Hilt and without a server.
 */
internal interface SetItemActions {
    /** [colorId] only counts for parts; a figure opens its own ViewModel. */
    fun openSetItem(number: String, colorId: Int = NO_COLOR)
    fun closeSetItem()
    fun setPartLocation(number: String, color: Int, location: String)
}

/** A ViewModel with the detail "which sets is this in", as the list and detail read it. */
internal interface WithSetItem : SetItemActions, FilterChoice {
    val setItemState: StateFlow<SetItemUiState>
}

internal interface PartsActions : SetItemActions {
    fun loadParts(page: Int = 1, debounce: Boolean = false)
    fun loadPartsColors()
    fun setPartsQuery(q: String)
    fun setPartsSpare(value: SparePartChoice)
    fun setPartsView(value: ListView)
    fun setPartsOrder(value: PartsFilter.Order)
    fun setPartsColorFilter(value: ColorPicker)
    fun setPartsCategoryFilter(value: CategoryChoice)
    fun setScope(view: ScopeFilter.View, value: String)
    fun setStorageFilter(view: ScopeFilter.View, value: String)
    fun loadLocationStock(owner: List<Int>)

    fun addPart(entry: PartEntry)
    fun updatePart(partNumber: String, colorId: Int, quantity: Int, unitPrice: Double?,
                   condition: Condition? = null, owner: Int? = null)
    fun deletePart(partNumber: String, colorId: Int, owner: Int? = null)
    /** Delete with "Rückgängig"; without a list behind it to offer that, delete right away. */
    fun partDeleteReserve(partNumber: String, colorId: Int, owner: Int?, name: String) =
        deletePart(partNumber, colorId, owner)
    fun setPartColor(partNumber: String, colorId: Int, newColor: Int,
                       colorName: String? = null, colorHex: String? = null,
                       owner: Int? = null, onDone: (Int) -> Unit = {})
}

internal interface FiguresActions : SetItemActions {
    fun loadMinifigs(debounce: Boolean = false)
    fun setMinifigsQuery(q: String)
    fun setMinifigsView(value: ListView)
    fun setScope(view: ScopeFilter.View, value: String)

    fun addMinifig(entry: FigureEntry)
    fun updateMinifig(figNumber: String, quantity: Int, unitPrice: Double?, blFigNumber: String? = null,
                      condition: Condition? = null, owner: Int? = null)
    fun deleteMinifig(figNumber: String, owner: Int? = null)
    /** Delete with "Rückgängig"; without a list behind it to offer that, delete right away. */
    fun minifigDeleteReserve(figNumber: String, owner: Int?, name: String) = deleteMinifig(figNumber, owner)
    fun setMinifigsOrder(value: FigureOrder) = Unit

    /** Figuren haben keinen eigenen Lagerort: Sie stecken in ihrem Set. */
    override fun setPartLocation(number: String, color: Int, location: String) = Unit
}
