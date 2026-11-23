package ch.brickinventoryapp.finances

import ch.brickinventoryapp.finances.ui.minifigRows
import ch.brickinventoryapp.finances.ui.partRows
import ch.brickinventoryapp.model.domain.ManualMinifigView
import ch.brickinventoryapp.model.domain.ManualPartView
import ch.brickinventoryapp.model.domain.Money
import ch.brickinventoryapp.model.domain.ValuationPurchaseView
import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * The two rows of the finance table show the same thing.
 *
 * Counter-check: in partRows() `acq?.purchasePrice ?:
 * p.purchasePrice` replaced with `p.purchasePrice` → red “both call sites
 * pass the purchase price through” (150.0 instead of 120.0).
 */
class FinanceRowsEqualTest {

    @Test
    fun `both call sites pass the purchase price through`() {
        // The entry takes priority over the item: with several purchases, every row has
        // its own purchase price, exactly as with the sets.
        val purchases = listOf(ValuationPurchaseView(id = 1, purchasePrice = Money.from(120.0)),
                            ValuationPurchaseView(id = 2, purchasePrice = Money.from(80.0)))
        val part = ManualPartView(id = 1, partNumber = "3001", purchasePrice = Money.from(150.0), acquisitions = purchases)
        val figure = ManualMinifigView(id = 2, figNumber = "sw0001", purchasePrice = Money.from(150.0), acquisitions = purchases)
        assertEquals(listOf(Money.from(120.0), Money.from(80.0)), partRows(listOf(part)).map { it.second.purchasePrice })
        assertEquals(listOf(Money.from(120.0), Money.from(80.0)), minifigRows(listOf(figure)).map { it.second.purchasePrice })
        assertEquals(listOf(Money.from(150.0)), partRows(listOf(part.copy(acquisitions = emptyList()))).map { it.second.purchasePrice })
    }
}
