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
 * Preis und G&V auf der Galeriekachel: vom Server (kachel_preis,
 * kachel_pnl_pct), bei älteren Servern die frühere Rechnung der App (Übergang).
 *
 * Gegenproben:
 *   S  in tilePrices() immer tilePriceBeforeServer() genommen → rot „die
 *      Kachel nimmt Betrag und G&V des Servers“ (800,0 statt 812,5)
 *   T  die Bedingung auf `e.kachelPreis != null` verkürzt → rot ebenda am
 *      zweiten Set (nur kachel_pnl_pct gesetzt)
 *
 * Gegenproben (am 28.10.2026 gemessen, kotlinc gegen TilePrice.kt):
 *   A  bei mehreren Zeilen die erste genommen statt gewichtet → rot „zwei
 *      Zustände …“ (750,0 statt 191,7)
 *   B  nur pnl_pct gelesen, baseline_pnl_pct nicht → rot „eine Zeile ohne
 *      Kaufpreis …“
 *   C  in tileAmount() den Kaufpreis vor den Marktpreis gestellt → rot
 *      „der Marktpreis geht vor …“
 *
 * Gegenprobe:
 *   Q  in kachelQuelle() `preis.quelle == "kauf"` nicht beachtet → rot „die
 *      Quelle des Servers …“ (MARKT statt PURCHASE); in der Oberfläche misst es
 *      gegenproben/kachel-quelle-ignoriert.patch
 */
class TilePriceTest {

    @Test
    fun `die Kachel nimmt Betrag und G&V des Servers`() {
        // Die alten Felder ergäben 800,0 und 14,3; der Server hat im Haushalt gewichtet.
        val p = tilePrices(listOf(
            PnlSetZeile(setNumber = "75192-1", quantity = 1, currentPrice = 800.0, baselinePrice = 700.0, pnlPct = null, baselinePnlPct = "14.3",
                        kachelPreis = 812.5, kachelPnlPct = 16.1),
            PnlSetZeile(setNumber = "10294-1", quantity = 1, currentPrice = 0.0, baselinePrice = null, kachelPreis = null, kachelPnlPct = -3.0),
        ))
        assertEquals(TilePrice(Geld.aus(812.5), 16.1), p["75192-1"])
        assertEquals(TilePrice(null, -3.0), p["10294-1"])
    }

    @Test
    fun `Uebergang - eine Zeile ohne Kaufpreis nimmt den Basiswert des Servers`() {
        val p = tilePrices(listOf(PnlSetZeile(setNumber = "75192-1", quantity = 1, currentPrice = 800.0, baselinePrice = 700.0, pnlPct = null, baselinePnlPct = "14.3")))
        assertEquals(TilePrice(Geld.aus(800.0), 14.3), p["75192-1"])
    }

    @Test
    fun `Uebergang - zwei Zustaende werden nach Menge gewichtet, nicht die erste Zeile genommen`() {
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
    fun `der Marktpreis geht vor, sonst der gewichtete Kaufpreis`() {
        val set = SetAnsicht(setNumber = "1-1", avgPurchasePrice = Geld.aus(40.0), maxPurchasePrice = Geld.aus(60.0))
        assertEquals(Geld.aus(55.0), tileAmount(set, TilePrice(Geld.aus(55.0), 37.5)))
        assertEquals(Geld.aus(40.0), tileAmount(set, TilePrice(Geld.aus(0.0), null)))
        assertEquals(Geld.aus(40.0), tileAmount(set, null))
        assertNull(tileAmount(SetAnsicht(setNumber = "2-1"), null))
    }

    @Test
    fun `die Quelle des Servers bestimmt die Beschriftung der Kachel`() {
        val p = tilePrices(listOf(PnlSetZeile(setNumber = "21318-1", quantity = 1, currentPrice = null, baselinePrice = 180.0, kachelPreis = 180.0, kachelQuelle = "kauf")))
        assertEquals(TilePrice(Geld.aus(180.0), null, "kauf"), p["21318-1"])
        val set = SetAnsicht(setNumber = "21318-1")
        assertEquals(TileSource.PURCHASE, kachelQuelle(set, p["21318-1"]))
        assertEquals(TileSource.MARKT, kachelQuelle(set, TilePrice(Geld.aus(812.5), 16.1, "markt")))
        // Ältere Server ohne kachel_quelle lieferten nur Marktpreise.
        assertEquals(TileSource.MARKT, kachelQuelle(set, TilePrice(Geld.aus(812.5), 16.1)))
        assertEquals(TileSource.PURCHASE, kachelQuelle(SetAnsicht(setNumber = "1-1", avgPurchasePrice = Geld.aus(40.0)), null))
        assertNull(kachelQuelle(set, null))
    }
}

/** Die Zeilen wie der Server sie schickt, abgebildet wie im FinancesRepository. */
private fun tilePrices(z: List<PnlSetZeile>) = tilePrices(z.map { it.alsAnsicht() })
