package ch.brickinventoryapp.state.ui

import ch.brickinventoryapp.model.ui.Laden
import ch.brickinventoryapp.model.domain.Postenart
import ch.brickinventoryapp.model.domain.KaufAnsicht
import ch.brickinventoryapp.model.domain.PurchaseSumsView
import ch.brickinventoryapp.model.domain.OHNE_FARBE
import ch.brickinventoryapp.model.domain.PriceHistoryView
/**
 * State for the detail dialog of manually captured parts and minifigs.
 * Separated from the main state so acquisition updates (which happen
 * frequently while editing) don't recompose the whole app.
 */
data class ManualItemDetailUiState(
    val acquisitions: List<KaufAnsicht> = emptyList(),
    /** Total row from the server — see SetDetailUiState.acquisitionTotals. */
    val acquisitionTotals: PurchaseSumsView = PurchaseSumsView(),
    val purchasesFetch: Laden<Unit> = Laden.Daten(Unit),
    // Identifies the currently open element
    val itemType: Postenart? = null,
    val itemId: String = "",         // part_number or fig_number
    val colorId: Int = OHNE_FARBE,
    // No total quantity of its own: the display follows the sum of the captured entries.
    /** Market price by condition and history — the same response shape as for the set. */
    val priceHistory: PriceHistoryView? = null,
    val historyFetch: Laden<Unit> = Laden.Daten(Unit),
)
