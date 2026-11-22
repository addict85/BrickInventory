package ch.brickinventoryapp.collection

import ch.brickinventoryapp.model.domain.Geld
import ch.brickinventoryapp.model.domain.SetAnsicht
import ch.brickinventoryapp.contract.PnlSetZeile
import ch.brickinventoryapp.contract.mapping.alsAnsicht
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test
import ch.brickinventoryapp.collection.ui.TilePrice
import ch.brickinventoryapp.collection.ui.TileSource
import ch.brickinventoryapp.collection.ui.tileAmount
import ch.brickinventoryapp.collection.ui.tilePrices
import ch.brickinventoryapp.collection.ui.kachelQuelle

/**
 * Price and P&L on the gallery tile: from the server (kachel_preis,
 * kachel_pnl_pct), on older servers the app's earlier calculation (transition).
 *
 * Counter-checks:
 *   S  in tilePrices() tilePriceBeforeServer() always taken → red “the
 *      tile takes the server's amount and P&L” (800.0 instead of 812.5)
 *   T  the condition shortened to `e.kachelPreis != null` → red at the same
 *      place on the second set (only kachel_pnl_pct set)
 *
 * Counter-checks (measured 28.10.2026, kotlinc against TilePrice.kt):
 *   A  with several rows the first one taken instead of weighted → red “two
 *      states …” (750.0 instead of 191.7)
 *   B  only pnl_pct read, not baseline_pnl_pct → red “a row without
 *      a purchase price …”
 *   C  in tileAmount() the purchase price put ahead of the market price → red
 *      “the market price takes priority …”
 *
 * Counter-check:
 *   Q  in kachelQuelle() `preis.quelle == "kauf"` not honored → red “the
 *      server's source …” (MARKT instead of PURCHASE); measured in the UI by
 *      gegenproben/kachel-quelle-ignoriert.patch
 */
class TilePriceTest {

    @Test
    fun `the tile takes the server's amount and P&L`() {
        // The old fields would give 800.0 and 14.3; the server weighted across the household.
        val p = tilePrices(listOf(
            PnlSetZeile(setNumber = "75192-1", quantity = 1, currentPrice = 800.0, baselinePrice = 700.0, pnlPct = null, baselinePnlPct = "14.3",
                        kachelPreis = 812.5, kachelPnlPct = 16.1),
            PnlSetZeile(setNumber = "10294-1", quantity = 1, currentPrice = 0.0, baselinePrice = null, kachelPreis = null, kachelPnlPct = -3.0),
        ))
        assertEquals(TilePrice(Geld.aus(812.5), 16.1), p["75192-1"])
        assertEquals(TilePrice(null, -3.0), p["10294-1"])
    }

    @Test
    fun `transition - a row without purchase price takes the server's base value`() {
        val p = tilePrices(listOf(PnlSetZeile(setNumber = "75192-1", quantity = 1, currentPrice = 800.0, baselinePrice = 700.0, pnlPct = null, baselinePnlPct = "14.3")))
        assertEquals(TilePrice(Geld.aus(800.0), 14.3), p["75192-1"])
    }

    @Test
    fun `transition - two conditions are weighted by quantity, not the first row taken`() {
        val p = tilePrices(listOf(
            PnlSetZeile(setNumber = "10294-1", quantity = 1, currentPrice = 350.0, baselinePrice = 160.0, pnlPct = "118.8"),
            PnlSetZeile(setNumber = "10294-1", quantity = 2, currentPrice = 350.0, baselinePrice = 100.0, pnlPct = "250.0"),
            PnlSetZeile(setNumber = "10294-1", quantity = 1, currentPrice = 350.0, baselinePrice = null),
        ))
        // (2·100 + 1·160) / 3 = 120 → (350 − 120) / 120 = 191,7 %
        assertEquals(191.7, p["10294-1"]?.pnlPct ?: -1.0, 1e-9)
        assertEquals(Geld.aus(350.0), p["10294-1"]?.betrag)
    }

    @Test
    fun `the market price goes first, otherwise the weighted purchase price`() {
        val set = SetAnsicht(setNumber = "1-1", avgPurchasePrice = Geld.aus(40.0), maxPurchasePrice = Geld.aus(60.0))
        assertEquals(Geld.aus(55.0), tileAmount(set, TilePrice(Geld.aus(55.0), 37.5)))
        assertEquals(Geld.aus(40.0), tileAmount(set, TilePrice(Geld.aus(0.0), null)))
        assertEquals(Geld.aus(40.0), tileAmount(set, null))
        assertNull(tileAmount(SetAnsicht(setNumber = "2-1"), null))
    }

    @Test
    fun `the server's source determines the tile's label`() {
        val p = tilePrices(listOf(PnlSetZeile(setNumber = "21318-1", quantity = 1, currentPrice = null, baselinePrice = 180.0, kachelPreis = 180.0, kachelQuelle = "kauf")))
        assertEquals(TilePrice(Geld.aus(180.0), null, "kauf"), p["21318-1"])
        val set = SetAnsicht(setNumber = "21318-1")
        assertEquals(TileSource.PURCHASE, kachelQuelle(set, p["21318-1"]))
        assertEquals(TileSource.MARKT, kachelQuelle(set, TilePrice(Geld.aus(812.5), 16.1, "markt")))
        // Older servers without kachel_quelle delivered only market prices.
        assertEquals(TileSource.MARKT, kachelQuelle(set, TilePrice(Geld.aus(812.5), 16.1)))
        assertEquals(TileSource.PURCHASE, kachelQuelle(SetAnsicht(setNumber = "1-1", avgPurchasePrice = Geld.aus(40.0)), null))
        assertNull(kachelQuelle(set, null))
    }
}

/** The rows as the server sends them, mapped as in FinancesRepository. */
private fun tilePrices(z: List<PnlSetZeile>) = tilePrices(z.map { it.alsAnsicht() })
