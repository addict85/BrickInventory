package ch.brickinventoryapp.parts

import ch.brickinventoryapp.contract.FigValuationItem
import ch.brickinventoryapp.contract.PartValuationItem
import ch.brickinventoryapp.model.json.BrickJson
import ch.brickinventoryapp.testing.Sources
import org.junit.Assert.assertEquals
import org.junit.Test
import java.io.File

/**
 * What a manually entered tile and its detail need: the quantity-weighted
 * purchase price from the server and the price history for parts and figures. What the tile
 * renders is checked by ManualTileDisplayTest (app) under Robolectric; that the history
 * is loaded for both kinds, by PurchasesViewModelTest (core-state) on the ViewModel.
 */
class ManualTileTest {

    private fun read(rel: String) =
        File(Sources.root, "$rel").readText()
    private fun code(s: String) = s.lines()
        .joinToString("\n") { if (it.trim().startsWith("//") || it.trim().startsWith("*")) "" else it }

    @Test
    fun `the quantity-weighted purchase price comes from the server`() {
        // `unit_price` in the master row is only the MOST RECENTLY written
        // unit price. Anyone who bought once for 2.- and once for 8.-
        // would see 8.- there instead of 5.-. The server computes it correctly
        // (utils/handlers/shared.ts) — the app simply did not read that field.
        val part = BrickJson.decodeFromString(PartValuationItem.serializer(),
            """{"part_number":"3001","unit_price":8.0,"avg_purchase_price":5.0}""")
        val figure = BrickJson.decodeFromString(FigValuationItem.serializer(),
            """{"fig_number":"sw0001","unit_price":8.0,"avg_purchase_price":5.0}""")
        assertEquals(5.0, part.avgPurchasePrice ?: 0.0, 0.0)
        assertEquals(5.0, figure.avgPurchasePrice ?: 0.0, 0.0)
    }

    // The value tiles like in the set detail; a large price row in the market-price card
    // repeated them (used to live here, in PurchasePriceDisplayTest, core-data).
    @Test
    fun `the detail view shows value tiles, market price and price history, without a large price row`() {
        val s = code(read("parts/ui/screens/ManualItemDetailScreen.kt"))
        for (part in listOf("ValueTiles(", "MarketPriceByCondition(", "PriceChart(")) {
            assert(s.contains(part)) { "$part fehlt in der Detailansicht" }
        }
        assert(!s.contains("headlineSmall")) { "wieder eine grosse Preiszeile neben den Kacheln" }
    }
}
