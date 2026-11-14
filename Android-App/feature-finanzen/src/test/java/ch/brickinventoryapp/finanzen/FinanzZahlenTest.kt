package ch.brickinventoryapp.finanzen

import ch.brickinventoryapp.model.fach.Waehrung
import ch.brickinventoryapp.model.fach.Zustand
import ch.brickinventoryapp.model.json.BrickJson
import ch.brickinventoryapp.model.data.model.FigsValuationResponse
import ch.brickinventoryapp.model.data.model.Gutschein
import ch.brickinventoryapp.model.data.model.PartsValuationResponse
import ch.brickinventoryapp.model.data.model.PnlResponse
import ch.brickinventoryapp.model.data.model.PnlTotals
import ch.brickinventoryapp.model.ui.model.alsAnsicht
import ch.brickinventoryapp.model.data.model.PriceHistoryResponse
import ch.brickinventoryapp.model.data.model.ValuationResponse
import ch.brickinventoryapp.finanzen.ui.figurZeilen
import ch.brickinventoryapp.finanzen.ui.finanzSummen
import ch.brickinventoryapp.finanzen.ui.fremdeKaufpreise
import ch.brickinventoryapp.finanzen.ui.gutscheinSumme
import ch.brickinventoryapp.finanzen.ui.setZeilen
import ch.brickinventoryapp.finanzen.ui.teilZeilen
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test
import java.math.BigDecimal
import ch.brickinventoryapp.finanzen.ui.FinanzZeile
import ch.brickinventoryapp.finanzen.ui.finanzKopf

/**
 * Die Finanzseite zeigt die Zahlenfelder des Servers (wert_gesamt,
 * pnl_prozent, kaufpreise_fremde_waehrung) und rechnet selbst gebildete
 * Geldsummen in BigDecimal. Die Textfelder im Testdatensatz tragen absichtlich
 * andere Werte: Liest die App sie, wird der Test rot.
 *
 * Gegenproben:
 *   A  in setZeilen() `wert = acq?.wertGesamt ?: s.wertGesamt` durch
 *      `acq?.totalAvg?.toDoubleOrNull()` ersetzt → rot „jede Erfassung zeigt
 *      ihren eigenen Wert und ihre G&V als Zahl“ (999.99 statt 240.67)
 *   B  in finanzSummen() die Rückfallsumme mit Double gebildet → rot „ohne
 *      grand_total addiert die App exakt“ (0.30000000000000004)
 *   C  in fremdeKaufpreise() ohne pnl nur valuation gelesen → rot „Teile und
 *      Figuren lesen dieselben Zahlenfelder“ (1 statt 4)
 *   D  in gutscheinSumme() `distinct().singleOrNull()` durch `firstOrNull()` ersetzt
 *      → rot „Gutscheine in zwei Währungen ergeben keine Summe“
 *   E  Patch finanzen-kauf-je-stueck: kaufGesamt ohne Menge → rot „Kauf und Gewinn
 *      stehen auf der Grundlage des Marktwerts“ (400.0 statt 800.0); nur CI
 *   F  finanzKopf nimmt purchase und grand_total statt der Basis (wie Patch
 *      finanzen-kopf-ohne-basis, dort gegen OberflaechenRegelnTest gemessen) → rot
 *      „die Kopfkarte rechnet auf der Basis des Servers“ (Einstand 1680 statt 1500);
 *      von Hand durchgespielt, kein Android-SDK in der Sitzung
 *   G  in finanzKopf() die Rückkehr für ältere Server entfernt → rot „ohne
 *      Basisfelder bleibt die Kopfkarte wie bisher“ (basisBekannt true); von Hand
 *      durchgespielt, nicht gemessen (kein Android-SDK in der Sitzung)
 */
class FinanzZahlenTest {

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
    fun `jede Erfassung zeigt ihren eigenen Wert und ihre G&V als Zahl`() {
        assertEquals(12, bewertung.ttlStunden)
        val zeilen = setZeilen(bewertung.sets).map { it.second }
        assertEquals(listOf("10294-1#7", "10294-1#8", "75192-1#0"), zeilen.map { it.schluessel })
        assertEquals(listOf(240.67, 240.67, 812.5), zeilen.map { it.wert })
        assertEquals(listOf(140.7, 20.3, 16.1), zeilen.map { it.pnlProzent })
        assertEquals(listOf(100.0, 200.0, 700.0), zeilen.map { it.kaufpreis })
        assertEquals(listOf(Zustand.NEU, Zustand.GEBRAUCHT, null), zeilen.map { it.zustand })
    }

    @Test
    fun `Teile und Figuren lesen dieselben Zahlenfelder`() {
        val teile = BrickJson.decodeFromString(PartsValuationResponse.serializer(), """{
            "success": true, "total_value": "0.20", "kaufpreise_fremde_waehrung": 2,
            "parts": [{"id": 3, "part_number": "3001", "quantity": 4, "display_value": "999.99",
                       "wert_gesamt": 1.2, "purchase_price": 0.25, "pnl_pct": "-50.0", "pnl_prozent": 20.0}]}""").alsAnsicht()
        val figuren = BrickJson.decodeFromString(FigsValuationResponse.serializer(), """{
            "success": true, "total_value": "0.00", "kaufpreise_fremde_waehrung": 1,
            "figs": [{"id": 5, "fig_number": "sw0001", "display_value": "999.99", "wert_gesamt": 30.0,
                      "acquisitions": [{"id": 9, "condition": "U", "quantity": 1, "purchase_price": 20.0,
                                        "wert_gesamt": 30.0, "pnl_prozent": 50.0}]}]}""").alsAnsicht()
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
        val teile = PartsValuationResponse(success = true, totalValue = "0.20").alsAnsicht()
        val ohne = finanzSummen(bewertung, teile, null, PnlResponse(success = true, totals = PnlTotals(purchase = "0.00", current = "0.00")).alsAnsicht())
        assertEquals(0, BigDecimal("0.30").compareTo(ohne.gesamt))
        assertEquals(0, BigDecimal("0.20").compareTo(ohne.teileUndFiguren))
        val mit = finanzSummen(bewertung, teile, null, BrickJson.decodeFromString(PnlResponse.serializer(),
            """{"success": true, "totals": {"purchase": "4000.00", "current": "4894.77", "grand_total": "4894.77"}}""").alsAnsicht())
        assertEquals(0, BigDecimal("4894.77").compareTo(mit.gesamt))
    }

    @Test
    fun `fremde Kaufpreise zaehlt pnl ueber alle drei Arten`() {
        val pnl = BrickJson.decodeFromString(PnlResponse.serializer(), """{"success": true,
            "totals": {"purchase": "100.00", "current": "112.50", "pnl_pct": "-50.0", "pnl_prozent": 12.5, "kaufpreise_fremde_waehrung": 4},
            "sets": [{"set_number": "1-1", "pnl_abs": "9.00", "pnl_betrag": 9.0, "pnl_prozent": 3.4,
                      "baseline_pnl_prozent": 3.4}]}""").alsAnsicht()
        assertEquals(4, fremdeKaufpreise(bewertung, null, null, pnl))
        assertEquals(12.5, pnl.totals.pnlProzent!!, 0.0)
        assertEquals(9.0, pnl.sets.single().pnlBetrag!!, 0.0)
        assertEquals(3.4, pnl.sets.single().baselinePnlProzent!!, 0.0)
    }

    @Test
    fun `der Preisverlauf liefert die G&V als Zahl`() {
        val h = BrickJson.decodeFromString(PriceHistoryResponse.serializer(),
            """{"success": true, "pnl_pct": "-50.0", "pnl_prozent": 16.1}""")
        assertEquals(16.1, h.pnlProzent!!, 0.0)
    }

    @Test
    fun `Gutscheine in zwei Waehrungen ergeben keine Summe`() {
        val chf = listOf(Gutschein(id = 1, amount = 0.1), Gutschein(id = 2, amount = 0.2)).map { it.alsAnsicht() }
        assertEquals(BigDecimal("0.30") to Waehrung.CHF, gutscheinSumme(chf))
        assertNull(gutscheinSumme(chf + Gutschein(id = 3, amount = 5.0, currency = Waehrung("EUR")).alsAnsicht()))
        assertNull(gutscheinSumme(emptyList()))
    }

    /**
     * Der Marktwert einer Zeile gilt für alle Stück (wert_gesamt), der Kaufpreis des
     * Servers je Stück. Kauf und Gewinn der Karte stehen auf derselben Grundlage wie
     * der Marktwert — sonst las sich Titanic ×2 (CHF 899.90, Kauf 400) wie +125 %.
     */
    @Test
    fun `Kauf und Gewinn stehen auf der Grundlage des Marktwerts`() {
        val zwei = FinanzZeile("t", menge = 2, wert = 899.9, kaufpreis = 400.0,
            zustand = Zustand.NEU, pnlProzent = 12.5)
        assertEquals(800.0, zwei.kaufGesamt!!, 0.0)
        assertEquals(99.9, zwei.gewinn!!, 0.0)
        val eins = zwei.copy(menge = 1, wert = 0.3, kaufpreis = 0.1)
        assertEquals(0.1, eins.kaufGesamt!!, 0.0)
        // BigDecimal: 0.3 - 0.1 ist als Double 0.19999999999999998.
        assertEquals(0.2, eins.gewinn!!, 0.0)
        assertNull(zwei.copy(wert = null).gewinn)
        assertNull(zwei.copy(kaufpreis = null).kaufGesamt)
    }

    private fun pnl(totals: String) =
        BrickJson.decodeFromString(PnlResponse.serializer(), """{"success": true, "totals": $totals}""").alsAnsicht()

    /**
     * Einstand, Marktwert und G/V der Kopfkarte aus der Basis des Servers: Aus allen
     * Positionen gerechnet stünde Einstand 1680 neben Marktwert 1712.40 und +14.2 %.
     */
    @Test
    fun `die Kopfkarte rechnet auf der Basis des Servers`() {
        val k = finanzKopf(bewertung, null, null, pnl("""{"purchase": "1680.00",
            "current": "1712.40", "grand_total": "1712.40", "pnl_prozent": 14.2, "positionen": 3,
            "positionen_bewertet": 2, "positionen_ohne_marktpreis": 1, "positionen_ohne_kaufpreis": 0,
            "basis_einstand": "1500.00", "basis_marktwert": "1712.40", "basis_guv_betrag": "212.40",
            "ohne_marktpreis_einstand": "180.00", "ohne_kaufpreis_marktwert": "0.00"}"""))
        assertEquals(0, BigDecimal("1500.00").compareTo(k.einstand!!))
        assertEquals(0, BigDecimal("1712.40").compareTo(k.wert))
        assertEquals(0, BigDecimal("212.40").compareTo(k.guvBetrag!!))
        assertEquals(0, k.einstand.add(k.guvBetrag).compareTo(k.wert))
        assertEquals(14.2, k.guvProzent!!, 0.0)
        assertEquals(listOf(3, 2, 1, 0), listOf(k.gesamt, k.bewertet, k.ohneMarkt, k.ohneKauf))
        assertEquals(0, BigDecimal("180.00").compareTo(k.ohneMarktEinstand))
        assertEquals(true, k.basisZeileSichtbar)
    }

    @Test
    fun `ohne Basisfelder bleibt die Kopfkarte wie bisher`() {
        val k = finanzKopf(bewertung, null, null,
            pnl("""{"purchase": "1680.00", "current": "1712.40", "grand_total": "1712.40", "pnl_prozent": 1.9}"""))
        assertEquals(false, k.basisBekannt)
        assertNull("kein Einstand: die alte Karte zeigte keinen", k.einstand)
        assertNull(k.guvBetrag)
        assertEquals(0, BigDecimal("1712.40").compareTo(k.wert))
        assertEquals(1.9, k.guvProzent!!, 0.0)
        assertEquals(false, k.basisZeileSichtbar)
    }

    /** Keine Position mit beiden Preisen: Summen aller Positionen, keine G/V gegen nichts. */
    @Test
    fun `ohne bewertete Position gibt es keine G und V`() {
        val k = finanzKopf(bewertung, null, null, pnl("""{"purchase": "180.00",
            "current": "0.00", "grand_total": "0.00", "pnl_prozent": null, "positionen": 1,
            "positionen_bewertet": 0, "positionen_ohne_marktpreis": 1, "positionen_ohne_kaufpreis": 0,
            "basis_einstand": "0.00", "basis_marktwert": "0.00", "basis_guv_betrag": "0.00",
            "ohne_marktpreis_einstand": "180.00", "ohne_kaufpreis_marktwert": "0.00"}"""))
        assertEquals(false, k.mitBasis)
        assertEquals(0, BigDecimal("180.00").compareTo(k.einstand!!))
        assertNull(k.guvBetrag)
        assertNull(k.guvProzent)
        assertEquals(false, k.basisZeileSichtbar)
    }
}
