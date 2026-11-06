package ch.brickinventoryapp

import ch.brickinventoryapp.ui.model.SetAnsicht
import ch.brickinventoryapp.data.model.PnlSetZeile
import ch.brickinventoryapp.ui.KachelPreis
import ch.brickinventoryapp.ui.KachelQuelle
import ch.brickinventoryapp.ui.kachelQuelle
import ch.brickinventoryapp.ui.kachelBetrag
import ch.brickinventoryapp.ui.kachelPreise
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/**
 * Preis und G&V auf der Galeriekachel: vom Server (kachel_preis,
 * kachel_pnl_pct), bei älteren Servern die frühere Rechnung der App (Übergang).
 *
 * Gegenproben:
 *   S  in kachelPreise() immer kachelPreisVorServer() genommen → rot „die
 *      Kachel nimmt Betrag und G&V des Servers“ (800,0 statt 812,5)
 *   T  die Bedingung auf `e.kachelPreis != null` verkürzt → rot ebenda am
 *      zweiten Set (nur kachel_pnl_pct gesetzt)
 *
 * Gegenproben (am 28.10.2026 gemessen, kotlinc gegen KachelPreis.kt):
 *   A  bei mehreren Zeilen die erste genommen statt gewichtet → rot „zwei
 *      Zustände …“ (750,0 statt 191,7)
 *   B  nur pnl_pct gelesen, baseline_pnl_pct nicht → rot „eine Zeile ohne
 *      Kaufpreis …“
 *   C  in kachelBetrag() den Kaufpreis vor den Marktpreis gestellt → rot
 *      „der Marktpreis geht vor …“
 *
 * Gegenprobe:
 *   Q  in kachelQuelle() `preis.quelle == "kauf"` nicht beachtet → rot „die
 *      Quelle des Servers …“ (MARKT statt KAUF); in der Oberfläche misst es
 *      gegenproben/kachel-quelle-ignoriert.patch
 */
class KachelPreisTest {

    @Test
    fun `die Kachel nimmt Betrag und G&V des Servers`() {
        // Die alten Felder ergäben 800,0 und 14,3; der Server hat im Haushalt gewichtet.
        val p = kachelPreise(listOf(
            PnlSetZeile("75192-1", 1, 800.0, 700.0, pnlPct = null, baselinePnlPct = "14.3",
                        kachelPreis = 812.5, kachelPnlPct = 16.1),
            PnlSetZeile("10294-1", 1, 0.0, null, kachelPreis = null, kachelPnlPct = -3.0),
        ))
        assertEquals(KachelPreis(812.5, 16.1), p["75192-1"])
        assertEquals(KachelPreis(null, -3.0), p["10294-1"])
    }

    @Test
    fun `Uebergang - eine Zeile ohne Kaufpreis nimmt den Basiswert des Servers`() {
        val p = kachelPreise(listOf(PnlSetZeile("75192-1", 1, 800.0, 700.0, pnlPct = null, baselinePnlPct = "14.3")))
        assertEquals(KachelPreis(800.0, 14.3), p["75192-1"])
    }

    @Test
    fun `Uebergang - zwei Zustaende werden nach Menge gewichtet, nicht die erste Zeile genommen`() {
        val p = kachelPreise(listOf(
            PnlSetZeile("10294-1", 1, 350.0, 160.0, pnlPct = "118.8"),
            PnlSetZeile("10294-1", 2, 350.0, 100.0, pnlPct = "250.0"),
            PnlSetZeile("10294-1", 1, 350.0, null),
        ))
        // (2·100 + 1·160) / 3 = 120 → (350 − 120) / 120 = 191,7 %
        assertEquals(191.7, p["10294-1"]?.pnlPct ?: -1.0, 1e-9)
        assertEquals(350.0, p["10294-1"]?.betrag ?: -1.0, 1e-9)
    }

    @Test
    fun `der Marktpreis geht vor, sonst der gewichtete Kaufpreis`() {
        val set = SetAnsicht(setNumber = "1-1", avgPurchasePrice = 40.0, maxPurchasePrice = 60.0)
        assertEquals(55.0, kachelBetrag(set, KachelPreis(55.0, 37.5)) ?: -1.0, 1e-9)
        assertEquals(40.0, kachelBetrag(set, KachelPreis(0.0, null)) ?: -1.0, 1e-9)
        assertEquals(40.0, kachelBetrag(set, null) ?: -1.0, 1e-9)
        assertNull(kachelBetrag(SetAnsicht(setNumber = "2-1"), null))
    }

    @Test
    fun `die Quelle des Servers bestimmt die Beschriftung der Kachel`() {
        val p = kachelPreise(listOf(PnlSetZeile("21318-1", 1, null, 180.0, kachelPreis = 180.0, kachelQuelle = "kauf")))
        assertEquals(KachelPreis(180.0, null, "kauf"), p["21318-1"])
        val set = SetAnsicht(setNumber = "21318-1")
        assertEquals(KachelQuelle.KAUF, kachelQuelle(set, p["21318-1"]))
        assertEquals(KachelQuelle.MARKT, kachelQuelle(set, KachelPreis(812.5, 16.1, "markt")))
        // Ältere Server ohne kachel_quelle lieferten nur Marktpreise.
        assertEquals(KachelQuelle.MARKT, kachelQuelle(set, KachelPreis(812.5, 16.1)))
        assertEquals(KachelQuelle.KAUF, kachelQuelle(SetAnsicht(setNumber = "1-1", avgPurchasePrice = 40.0), null))
        assertNull(kachelQuelle(set, null))
    }
}
