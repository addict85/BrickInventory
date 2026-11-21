package ch.brickinventoryapp.finances

import ch.brickinventoryapp.model.domain.Geld
import ch.brickinventoryapp.model.domain.Waehrung
import ch.brickinventoryapp.model.domain.Zustand
import ch.brickinventoryapp.model.json.BrickJson
import ch.brickinventoryapp.contract.FigsValuationResponse
import ch.brickinventoryapp.contract.Gutschein
import ch.brickinventoryapp.contract.PartsValuationResponse
import ch.brickinventoryapp.contract.PnlResponse
import ch.brickinventoryapp.contract.PnlTotals
import ch.brickinventoryapp.contract.mapping.alsAnsicht
import ch.brickinventoryapp.contract.PriceHistoryResponse
import ch.brickinventoryapp.contract.ValuationResponse
import ch.brickinventoryapp.finances.ui.minifigRows
import ch.brickinventoryapp.finances.ui.finanzSummen
import ch.brickinventoryapp.finances.ui.foreignPurchasePrices
import ch.brickinventoryapp.finances.ui.voucherSum
import ch.brickinventoryapp.finances.ui.setRows
import ch.brickinventoryapp.finances.ui.partRows
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test
import java.math.BigDecimal
import ch.brickinventoryapp.finances.ui.FinanceRow
import ch.brickinventoryapp.finances.ui.financeHeader

/**
 * The finances page shows the server's number fields (wert_gesamt,
 * pnl_prozent, kaufpreise_fremde_waehrung) and itself computes only
 * money sums in BigDecimal. The text fields in the test data deliberately
 * carry different values: if the app reads them, the test turns red.
 *
 * Counter-checks:
 *   A  in setRows() `wert = acq?.wertGesamt ?: s.wertGesamt` replaced
 *      with `acq?.totalAvg?.toDoubleOrNull()` → red “every entry shows
 *      its own value and its P&L as a number” (999.99 instead of 240.67)
 *   B  in finanzSummen() the fallback sum formed with Double → red “without
 *      grand_total the app adds exactly” (0.30000000000000004)
 *   C  in foreignPurchasePrices() without pnl only valuation read → red “parts and
 *      figures read the same number fields” (1 instead of 4)
 *   D  in voucherSum() `distinct().singleOrNull()` replaced with `firstOrNull()`
 *      → red “vouchers in two currencies give no sum”
 *   E  patch finanzen-kauf-je-stueck: kaufGesamt without quantity → red “purchase and profit
 *      stand on the same basis as the market value” (400.0 instead of 800.0); CI only
 *   F  financeHeader takes purchase and grand_total instead of the basis (as with patch
 *      finanzen-kopf-ohne-basis, measured there against UisRulesTest) → red
 *      “the header card computes on the server's basis” (cost basis 1680 instead of 1500);
 *      played through by hand, no Android SDK in the session
 *   G  in financeHeader() the early return for older servers removed → red “without
 *      basis fields the header card stays as before” (baseKnown true); played through
 *      by hand, not measured (no Android SDK in the session)
 */
class FinanceNumbersTest {

    private val bewertung = BrickJson.decodeFromString(ValuationResponse.serializer(), """{
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
        ]}""").alsAnsicht()

    @Test
    fun `every acquisition shows its own value and its P&L as a number`() {
        assertEquals(12, bewertung.ttlStunden)
        val zeilen = setRows(bewertung.sets).map { it.second }
        assertEquals(listOf("10294-1#7", "10294-1#8", "75192-1#0"), zeilen.map { it.schluessel })
        assertEquals(listOf(240.67, 240.67, 812.5).map { Geld.aus(it) }, zeilen.map { it.wert })
        assertEquals(listOf(140.7, 20.3, 16.1), zeilen.map { it.pnlProzent })
        assertEquals(listOf(100.0, 200.0, 700.0).map { Geld.aus(it) }, zeilen.map { it.kaufpreis })
        assertEquals(listOf(Zustand.NEU, Zustand.GEBRAUCHT, null), zeilen.map { it.zustand })
    }

    @Test
    fun `parts and figures read the same number fields`() {
        val teile = BrickJson.decodeFromString(PartsValuationResponse.serializer(), """{
            "success": true, "total_value": "0.20", "kaufpreise_fremde_waehrung": 2,
            "parts": [{"id": 3, "part_number": "3001", "quantity": 4, "display_value": "999.99",
                       "wert_gesamt": 1.2, "purchase_price": 0.25, "pnl_pct": "-50.0", "pnl_prozent": 20.0}]}""").alsAnsicht()
        val figuren = BrickJson.decodeFromString(FigsValuationResponse.serializer(), """{
            "success": true, "total_value": "0.00", "kaufpreise_fremde_waehrung": 1,
            "figs": [{"id": 5, "fig_number": "sw0001", "display_value": "999.99", "wert_gesamt": 30.0,
                      "acquisitions": [{"id": 9, "condition": "U", "quantity": 1, "purchase_price": 20.0,
                                        "wert_gesamt": 30.0, "pnl_prozent": 50.0}]}]}""").alsAnsicht()
        val t = partRows(teile.parts).single().second
        assertEquals(Geld.aus(1.2), t.wert)
        assertEquals(20.0, t.pnlProzent!!, 0.0)
        assertEquals(Geld.aus(0.25), t.kaufpreis)
        val f = minifigRows(figuren.figs).single().second
        assertEquals("fig_5#9", f.schluessel)
        assertEquals(Geld.aus(30.0), f.wert)
        assertEquals(50.0, f.pnlProzent!!, 0.0)
        assertEquals(Geld.aus(20.0), f.kaufpreis)
        assertEquals(4, foreignPurchasePrices(bewertung, teile, figuren, pnl = null))
    }

    @Test
    fun `without grand_total the app adds exactly`() {
        val teile = PartsValuationResponse(success = true, totalValue = "0.20").alsAnsicht()
        val ohne = finanzSummen(bewertung, teile, null, PnlResponse(success = true, totals = PnlTotals(purchase = "0.00", current = "0.00")).alsAnsicht())
        assertEquals(0, BigDecimal("0.30").compareTo(ohne.gesamt))
        assertEquals(0, BigDecimal("0.20").compareTo(ohne.partsAndMinifigs))
        val mit = finanzSummen(bewertung, teile, null, BrickJson.decodeFromString(PnlResponse.serializer(),
            """{"success": true, "totals": {"purchase": "4000.00", "current": "4894.77", "grand_total": "4894.77"}}""").alsAnsicht())
        assertEquals(0, BigDecimal("4894.77").compareTo(mit.gesamt))
    }

    @Test
    fun `foreign purchase prices count pnl over all three kinds`() {
        val pnl = BrickJson.decodeFromString(PnlResponse.serializer(), """{"success": true,
            "totals": {"purchase": "100.00", "current": "112.50", "pnl_pct": "-50.0", "pnl_prozent": 12.5, "kaufpreise_fremde_waehrung": 4},
            "sets": [{"set_number": "1-1", "pnl_abs": "9.00", "pnl_betrag": 9.0, "pnl_prozent": 3.4,
                      "baseline_pnl_prozent": 3.4}]}""").alsAnsicht()
        assertEquals(4, foreignPurchasePrices(bewertung, null, null, pnl))
        assertEquals(12.5, pnl.totals.pnlProzent!!, 0.0)
        assertEquals(Geld.aus(9.0), pnl.sets.single().pnlBetrag)
        assertEquals(3.4, pnl.sets.single().baselinePnlProzent!!, 0.0)
    }

    @Test
    fun `the price history delivers the P&L as a number`() {
        val h = BrickJson.decodeFromString(PriceHistoryResponse.serializer(),
            """{"success": true, "pnl_pct": "-50.0", "pnl_prozent": 16.1}""")
        assertEquals(16.1, h.pnlProzent!!, 0.0)
    }

    @Test
    fun `vouchers in two currencies give no sum`() {
        val chf = listOf(Gutschein(id = 1, amount = 0.1), Gutschein(id = 2, amount = 0.2)).map { it.alsAnsicht() }
        assertEquals(BigDecimal("0.30") to Waehrung.CHF, voucherSum(chf))
        assertNull(voucherSum(chf + Gutschein(id = 3, amount = 5.0, currency = Waehrung("EUR")).alsAnsicht()))
        assertNull(voucherSum(emptyList()))
    }

    /**
     * A row's market value applies to all copies (wert_gesamt), the server's purchase price
     * to each copy. Purchase and profit of the card stand on the same basis as
     * the market value — otherwise Titanic ×2 (CHF 899.90, purchase 400) would read as +125 %.
     */
    @Test
    fun `purchase and profit stand on the basis of the market value`() {
        val zwei = FinanceRow("t", menge = 2, wert = Geld.aus(899.9), kaufpreis = Geld.aus(400.0),
            zustand = Zustand.NEU, pnlProzent = 12.5)
        assertEquals(Geld.aus(800.0), zwei.kaufGesamt)
        assertEquals(Geld.aus(99.9), zwei.gewinn)
        val eins = zwei.copy(menge = 1, wert = Geld.aus(0.3), kaufpreis = Geld.aus(0.1))
        assertEquals(Geld.aus(0.1), eins.kaufGesamt)
        // BigDecimal: 0.3 - 0.1 as a Double is 0.19999999999999998.
        assertEquals(Geld.aus(0.2), eins.gewinn)
        assertNull(zwei.copy(wert = null).gewinn)
        assertNull(zwei.copy(kaufpreis = null).kaufGesamt)
    }

    private fun pnl(totals: String) =
        BrickJson.decodeFromString(PnlResponse.serializer(), """{"success": true, "totals": $totals}""").alsAnsicht()

    /**
     * Cost basis, market value and P&L of the header card from the server's basis: computed
     * from all positions, cost basis would be 1680 next to market value 1712.40 and +14.2 %.
     */
    @Test
    fun `the header card computes on the server's basis`() {
        val k = financeHeader(bewertung, null, null, pnl("""{"purchase": "1680.00",
            "current": "1712.40", "grand_total": "1712.40", "pnl_prozent": 14.2, "positionen": 3,
            "positionen_bewertet": 2, "positionen_ohne_marktpreis": 1, "positionen_ohne_kaufpreis": 0,
            "basis_einstand": "1500.00", "basis_marktwert": "1712.40", "basis_guv_betrag": "212.40",
            "ohne_marktpreis_einstand": "180.00", "ohne_kaufpreis_marktwert": "0.00"}"""))
        assertEquals(0, BigDecimal("1500.00").compareTo(k.cost!!))
        assertEquals(0, BigDecimal("1712.40").compareTo(k.wert))
        assertEquals(0, BigDecimal("212.40").compareTo(k.guvAmount!!))
        assertEquals(0, k.cost.add(k.guvAmount).compareTo(k.wert))
        assertEquals(14.2, k.guvPercent!!, 0.0)
        assertEquals(listOf(3, 2, 1, 0), listOf(k.gesamt, k.valued, k.withoutMarket, k.withoutPurchase))
        assertEquals(0, BigDecimal("180.00").compareTo(k.withoutMarketCost))
        assertEquals(true, k.baseRowVisible)
    }

    @Test
    fun `without basis fields the header card stays as before`() {
        val k = financeHeader(bewertung, null, null,
            pnl("""{"purchase": "1680.00", "current": "1712.40", "grand_total": "1712.40", "pnl_prozent": 1.9}"""))
        assertEquals(false, k.baseKnown)
        assertNull("kein Einstand: die alte Karte zeigte keinen", k.cost)
        assertNull(k.guvAmount)
        assertEquals(0, BigDecimal("1712.40").compareTo(k.wert))
        assertEquals(1.9, k.guvPercent!!, 0.0)
        assertEquals(false, k.baseRowVisible)
    }

    /** No position with both prices: sums of all positions, no P&L against nothing. */
    @Test
    fun `without a valued position there is no P and L`() {
        val k = financeHeader(bewertung, null, null, pnl("""{"purchase": "180.00",
            "current": "0.00", "grand_total": "0.00", "pnl_prozent": null, "positionen": 1,
            "positionen_bewertet": 0, "positionen_ohne_marktpreis": 1, "positionen_ohne_kaufpreis": 0,
            "basis_einstand": "0.00", "basis_marktwert": "0.00", "basis_guv_betrag": "0.00",
            "ohne_marktpreis_einstand": "180.00", "ohne_kaufpreis_marktwert": "0.00"}"""))
        assertEquals(false, k.withBase)
        assertEquals(0, BigDecimal("180.00").compareTo(k.cost!!))
        assertNull(k.guvAmount)
        assertNull(k.guvPercent)
        assertEquals(false, k.baseRowVisible)
    }
}
