package ch.brickinventoryapp

import ch.brickinventoryapp.data.api.ApiJson
import ch.brickinventoryapp.data.model.FigsValuationResponse
import ch.brickinventoryapp.data.model.Gutschein
import ch.brickinventoryapp.data.model.PartsValuationResponse
import ch.brickinventoryapp.data.model.PnlResponse
import ch.brickinventoryapp.data.model.PriceHistoryResponse
import ch.brickinventoryapp.data.model.ValuationResponse
import ch.brickinventoryapp.ui.figurZeilen
import ch.brickinventoryapp.ui.finanzSummen
import ch.brickinventoryapp.ui.fremdeKaufpreise
import ch.brickinventoryapp.ui.gutscheinSumme
import ch.brickinventoryapp.ui.setZeilen
import ch.brickinventoryapp.ui.teilZeilen
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test
import java.math.BigDecimal

/**
 * Die Finanzseite zeigt die Zahlenfelder des Servers (wert_gesamt,
 * pnl_prozent, kaufpreise_fremde_waehrung) und rechnet selbst gebildete
 * Geldsummen in BigDecimal. Die Textfelder im Testdatensatz tragen absichtlich
 * andere Werte: Liest die App sie, wird der Test rot.
 *
 * Gegenproben (30.10.2026, gemessen mit kt-b2/bau.sh):
 *   A  in setZeilen() `wert = acq?.wertGesamt ?: s.wertGesamt` durch
 *      `acq?.totalAvg?.toDoubleOrNull()` ersetzt → rot „jede Erfassung zeigt
 *      ihren eigenen Wert und ihre G&V als Zahl“ (999.99 statt 240.67)
 *   B  in finanzSummen() die Rückfallsumme mit Double gebildet → rot „ohne
 *      grand_total addiert die App exakt“ (0.30000000000000004)
 *   C  in fremdeKaufpreise() ohne pnl nur valuation gelesen → rot „Teile und
 *      Figuren lesen dieselben Zahlenfelder“ (1 statt 4)
 *   D  in gutscheinSumme() `distinct().singleOrNull()` durch `firstOrNull()` ersetzt
 *      → rot „Gutscheine in zwei Währungen ergeben keine Summe“
 */
class FinanzZahlenTest {

    private val bewertung = ApiJson.decodeFromString(ValuationResponse.serializer(), """{
        "success": true, "currency": "CHF", "ttl_stunden": 12, "kaufpreise_fremde_waehrung": 1,
        "totals": {"min": "0.10", "avg": "0.10", "max": "0.10", "qty_avg": "0.10"},
        "sets": [
          {"set_number": "10294-1", "quantity": 2, "total_avg": "999.99", "wert_gesamt": 481.34,
           "purchase_price": 150.0, "pnl_prozent": 60.4,
           "acquisitions": [
             {"id": 7, "condition": "N", "quantity": 1, "purchase_price": 100.0, "total_avg": "999.99",
              "wert_gesamt": 240.67, "pnl_pct": "-50.0", "pnl_prozent": 140.7},
             {"id": 8, "condition": "U", "quantity": 1, "purchase_price": 200.0, "total_avg": "999.99",
              "wert_gesamt": 240.67, "pnl_pct": "-50.0", "pnl_prozent": 20.3}]},
          {"set_number": "75192-1", "quantity": 1, "total_avg": "999.99", "wert_gesamt": 812.5,
           "purchase_price": 700.0, "pnl_prozent": 16.1, "acquisitions": []}
        ]}""")

    @Test
    fun `jede Erfassung zeigt ihren eigenen Wert und ihre G&V als Zahl`() {
        assertEquals(12, bewertung.ttlStunden)
        val zeilen = setZeilen(bewertung.sets).map { it.second }
        assertEquals(listOf("10294-1#7", "10294-1#8", "75192-1#0"), zeilen.map { it.schluessel })
        assertEquals(listOf(240.67, 240.67, 812.5), zeilen.map { it.wert })
        assertEquals(listOf(140.7, 20.3, 16.1), zeilen.map { it.pnlProzent })
        assertEquals(listOf(100.0, 200.0, 700.0), zeilen.map { it.kaufpreis })
        assertEquals(listOf("N", "U", null), zeilen.map { it.zustand })
    }

    @Test
    fun `Teile und Figuren lesen dieselben Zahlenfelder`() {
        val teile = ApiJson.decodeFromString(PartsValuationResponse.serializer(), """{
            "success": true, "total_value": "0.20", "kaufpreise_fremde_waehrung": 2,
            "parts": [{"id": 3, "part_number": "3001", "quantity": 4, "display_value": "999.99",
                       "wert_gesamt": 1.2, "purchase_price": 0.25, "pnl_pct": "-50.0", "pnl_prozent": 20.0}]}""")
        val figuren = ApiJson.decodeFromString(FigsValuationResponse.serializer(), """{
            "success": true, "total_value": "0.00", "kaufpreise_fremde_waehrung": 1,
            "figs": [{"id": 5, "fig_number": "sw0001", "display_value": "999.99", "wert_gesamt": 30.0,
                      "acquisitions": [{"id": 9, "condition": "U", "quantity": 1, "purchase_price": 20.0,
                                        "wert_gesamt": 30.0, "pnl_prozent": 50.0}]}]}""")
        val t = teilZeilen(teile.parts).single().second
        assertEquals(1.2, t.wert!!, 0.0)
        assertEquals(20.0, t.pnlProzent!!, 0.0)
        assertEquals(0.25, t.kaufpreis!!, 0.0)
        val f = figurZeilen(figuren.figs).single().second
        assertEquals("fig_5#9", f.schluessel)
        assertEquals(30.0, f.wert!!, 0.0)
        assertEquals(50.0, f.pnlProzent!!, 0.0)
        assertEquals(20.0, f.kaufpreis!!, 0.0)
        assertEquals(4, fremdeKaufpreise(bewertung, teile, figuren, pnl = null))
    }

    @Test
    fun `ohne grand_total addiert die App exakt`() {
        val teile = PartsValuationResponse(success = true, totalValue = "0.20")
        val ohne = finanzSummen(bewertung, teile, null, PnlResponse(success = true))
        assertEquals(0, BigDecimal("0.30").compareTo(ohne.gesamt))
        assertEquals(0, BigDecimal("0.20").compareTo(ohne.teileUndFiguren))
        val mit = finanzSummen(bewertung, teile, null, ApiJson.decodeFromString(PnlResponse.serializer(),
            """{"success": true, "totals": {"grand_total": "4894.77"}}"""))
        assertEquals(0, BigDecimal("4894.77").compareTo(mit.gesamt))
    }

    @Test
    fun `fremde Kaufpreise zaehlt pnl ueber alle drei Arten`() {
        val pnl = ApiJson.decodeFromString(PnlResponse.serializer(), """{"success": true,
            "totals": {"pnl_pct": "-50.0", "pnl_prozent": 12.5, "kaufpreise_fremde_waehrung": 4},
            "sets": [{"set_number": "1-1", "pnl_abs": "9.00", "pnl_betrag": 9.0, "pnl_prozent": 3.4,
                      "baseline_pnl_prozent": 3.4}]}""")
        assertEquals(4, fremdeKaufpreise(bewertung, null, null, pnl))
        assertEquals(12.5, pnl.totals.pnlProzent!!, 0.0)
        assertEquals(9.0, pnl.sets.single().pnlBetrag!!, 0.0)
        assertEquals(3.4, pnl.sets.single().baselinePnlProzent!!, 0.0)
    }

    @Test
    fun `der Preisverlauf liefert die G&V als Zahl`() {
        val h = ApiJson.decodeFromString(PriceHistoryResponse.serializer(),
            """{"success": true, "pnl_pct": "-50.0", "pnl_prozent": 16.1}""")
        assertEquals(16.1, h.pnlProzent!!, 0.0)
    }

    @Test
    fun `Gutscheine in zwei Waehrungen ergeben keine Summe`() {
        val chf = listOf(Gutschein(id = 1, amount = 0.1), Gutschein(id = 2, amount = 0.2))
        assertEquals(BigDecimal("0.30") to "CHF", gutscheinSumme(chf))
        assertNull(gutscheinSumme(chf + Gutschein(id = 3, amount = 5.0, currency = "EUR")))
        assertNull(gutscheinSumme(emptyList()))
    }
}
