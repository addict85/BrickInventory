package ch.brickinventoryapp.finances

import ch.brickinventoryapp.model.domain.Geld
import ch.brickinventoryapp.model.domain.ValuationPurchaseView
import ch.brickinventoryapp.model.domain.ManualMinifigView
import ch.brickinventoryapp.model.domain.ManualPartView
import ch.brickinventoryapp.finances.ui.minifigRows
import ch.brickinventoryapp.finances.ui.partRows
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
        val kaeufe = listOf(ValuationPurchaseView(id = 1, purchasePrice = Geld.aus(120.0)),
                            ValuationPurchaseView(id = 2, purchasePrice = Geld.aus(80.0)))
        val teil = ManualPartView(id = 1, partNumber = "3001", purchasePrice = Geld.aus(150.0), acquisitions = kaeufe)
        val figur = ManualMinifigView(id = 2, figNumber = "sw0001", purchasePrice = Geld.aus(150.0), acquisitions = kaeufe)
        assertEquals(listOf(Geld.aus(120.0), Geld.aus(80.0)), partRows(listOf(teil)).map { it.second.kaufpreis })
        assertEquals(listOf(Geld.aus(120.0), Geld.aus(80.0)), minifigRows(listOf(figur)).map { it.second.kaufpreis })
        assertEquals(listOf(Geld.aus(150.0)), partRows(listOf(teil.copy(acquisitions = emptyList()))).map { it.second.kaufpreis })
    }
}
