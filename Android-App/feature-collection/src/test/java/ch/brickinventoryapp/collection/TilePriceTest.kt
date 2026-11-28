package ch.brickinventoryapp.collection

import ch.brickinventoryapp.collection.ui.TilePrice
import ch.brickinventoryapp.collection.ui.tileMarketPrice
import ch.brickinventoryapp.collection.ui.tilePrices
import ch.brickinventoryapp.contract.PnlSetRow
import ch.brickinventoryapp.contract.mapping.asView
import ch.brickinventoryapp.contract.testing.testPnlSetRow
import ch.brickinventoryapp.model.domain.Money
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/**
 * Price and P&L on the gallery tile: from the server (kachel_preis,
 * kachel_pnl_pct), on older servers the app's earlier calculation (transition).
 *
 * Counter-checks:
 *   S  in tilePrices() tilePriceBeforeServer() always taken → red “the
 *      tile takes the server's amount and P&L” (800.0 instead of 812.5)
 *   T  the condition shortened to `e.tilePrice != null` → red at the same
 *      place on the second set (only kachel_pnl_pct set)
 *
 * Counter-checks (measured 28.10.2026, kotlinc against TilePrice.kt):
 *   A  with several rows the first one taken instead of weighted → red “two
 *      states …” (750.0 instead of 191.7)
 *   B  only pnl_pct read, not baseline_pnl_pct → red “a row without
 *      a purchase price …”
 *
 * Counter-check:
 *   Q  in tileMarketPrice() `source != "purchase"` dropped → red “the tile shows
 *      only market prices …” (180.0 instead of null); measured in the UI by
 *      counter-checks/tile-source-ignored.patch
 */
class TilePriceTest {

    @Test
    fun `the tile takes the server's amount and P&L`() {
        // The old fields would give 800.0 and 14.3; the server weighted across the household.
        val p = tilePrices(listOf(
            testPnlSetRow(setNumber = "75192-1", quantity = 1, currentPrice = 800.0, baselinePrice = 700.0, pnlPct = null, baselinePnlPct = "14.3",
                        tilePrice = 812.5, tilePnlPct = 16.1),
            testPnlSetRow(setNumber = "10294-1", quantity = 1, currentPrice = 0.0, baselinePrice = null, tilePrice = null, tilePnlPct = -3.0),
        ))
        assertEquals(TilePrice(Money.from(812.5), 16.1), p["75192-1"])
        assertEquals(TilePrice(null, -3.0), p["10294-1"])
    }

    @Test
    fun `transition - a row without purchase price takes the server's base value`() {
        val p = tilePrices(listOf(testPnlSetRow(setNumber = "75192-1", quantity = 1, currentPrice = 800.0, baselinePrice = 700.0, pnlPct = null, baselinePnlPct = "14.3")))
        assertEquals(TilePrice(Money.from(800.0), 14.3), p["75192-1"])
    }

    @Test
    fun `transition - two conditions are weighted by quantity, not the first row taken`() {
        val p = tilePrices(listOf(
            testPnlSetRow(setNumber = "10294-1", quantity = 1, currentPrice = 350.0, baselinePrice = 160.0, pnlPct = "118.8"),
            testPnlSetRow(setNumber = "10294-1", quantity = 2, currentPrice = 350.0, baselinePrice = 100.0, pnlPct = "250.0"),
            testPnlSetRow(setNumber = "10294-1", quantity = 1, currentPrice = 350.0, baselinePrice = null),
        ))
        // (2·100 + 1·160) / 3 = 120 → (350 − 120) / 120 = 191,7 %
        assertEquals(191.7, p["10294-1"]?.pnlPct ?: -1.0, 1e-9)
        assertEquals(Money.from(350.0), p["10294-1"]?.amount)
    }

    @Test
    fun `the tile shows only market prices, never the purchase price`() {
        val p = tilePrices(listOf(testPnlSetRow(setNumber = "21318-1", quantity = 1, currentPrice = null, baselinePrice = 180.0, tilePrice = 180.0, tileSource = "purchase")))
        assertEquals(TilePrice(Money.from(180.0), null, "purchase"), p["21318-1"])
        assertNull(tileMarketPrice(p["21318-1"]))
        assertEquals(Money.from(812.5), tileMarketPrice(TilePrice(Money.from(812.5), 16.1, "market")))
        // Older servers without kachel_quelle delivered only market prices.
        assertEquals(Money.from(812.5), tileMarketPrice(TilePrice(Money.from(812.5), 16.1)))
        assertNull(tileMarketPrice(TilePrice(Money.from(0.0), null)))
        assertNull(tileMarketPrice(null))
    }
}

/** The rows as the server sends them, mapped as in FinancesRepository. */
private fun tilePrices(z: List<PnlSetRow>) = tilePrices(z.map { it.asView() })
