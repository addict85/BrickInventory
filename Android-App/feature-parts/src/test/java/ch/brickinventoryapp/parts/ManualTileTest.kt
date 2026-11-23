package ch.brickinventoryapp.parts

import ch.brickinventoryapp.contract.FigValuationItem
import ch.brickinventoryapp.contract.PartValuationItem
import ch.brickinventoryapp.model.json.BrickJson
import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * What a manually entered tile and its detail need: the quantity-weighted
 * purchase price from the server and the price history for parts and figures. What the tile
 * renders is checked by ManualTileDisplayTest and the detail by ManualItemDetailDisplayTest (app); that the history
 * is loaded for both kinds, by PurchasesViewModelTest (core-state) on the ViewModel.
 */
class ManualTileTest {

    @Test
    fun `the quantity-weighted purchase price comes from the server`() {
        // `unit_price` in the master row is only the MOST RECENTLY written
        // unit price. Anyone who bought once for 2.- and once for 8.-
        // would see 8.- there instead of 5.-. The server computes it correctly
        // (`utils/handlers/shared.ts`) — the app simply did not read that field.
        val part = BrickJson.decodeFromString(PartValuationItem.serializer(),
            """{"part_number":"3001","unit_price":8.0,"avg_purchase_price":5.0}""")
        val figure = BrickJson.decodeFromString(FigValuationItem.serializer(),
            """{"fig_number":"sw0001","unit_price":8.0,"avg_purchase_price":5.0}""")
        assertEquals(5.0, part.avgPurchasePrice ?: 0.0, 0.0)
        assertEquals(5.0, figure.avgPurchasePrice ?: 0.0, 0.0)
    }
}
