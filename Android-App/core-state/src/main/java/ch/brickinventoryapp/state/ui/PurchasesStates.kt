package ch.brickinventoryapp.state.ui

import ch.brickinventoryapp.model.domain.ItemKind
import ch.brickinventoryapp.model.domain.PriceHistoryView
import ch.brickinventoryapp.model.domain.PurchaseSumsView
import ch.brickinventoryapp.model.domain.PurchaseView
import ch.brickinventoryapp.model.domain.WITHOUT_COLOR
import ch.brickinventoryapp.uistate.Load
/**
 * State for the detail dialog of manually captured parts and minifigs.
 * Separated from the main state so acquisition updates (which happen
 * frequently while editing) don't recompose the whole app.
 */
data class ManualItemDetailUiState(
    val acquisitions: List<PurchaseView> = emptyList(),
    /** Total row from the server — see SetDetailUiState.acquisitionTotals. */
    val acquisitionTotals: PurchaseSumsView = PurchaseSumsView(),
    val purchasesFetch: Load<Unit> = Load.Data(Unit),
    // Identifies the currently open element
    val itemType: ItemKind? = null,
    val itemId: String = "",         // part_number or fig_number
    val colorId: Int = WITHOUT_COLOR,
    // No total quantity of its own: the display follows the sum of the captured entries.
    /** Market price by condition and history — the same response shape as for the set. */
    val priceHistory: PriceHistoryView? = null,
    val historyFetch: Load<Unit> = Load.Data(Unit),
)
