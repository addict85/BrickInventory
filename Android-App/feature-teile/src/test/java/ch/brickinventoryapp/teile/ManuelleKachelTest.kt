package ch.brickinventoryapp.teile

import ch.brickinventoryapp.data.api.ApiJson
import ch.brickinventoryapp.model.data.model.FigValuationItem
import ch.brickinventoryapp.model.data.model.PartValuationItem
import org.junit.Assert.assertEquals
import org.junit.Test
import java.io.File
import ch.brickinventoryapp.testing.Quellen

/**
 * Was eine manuell erfasste Kachel und ihr Detail brauchen: den mengengewichteten
 * Kaufpreis vom Server und den Preisverlauf für Teile und Figuren. Was die Kachel
 * zeichnet, prüft ManuelleKachelAnzeigeTest (app) unter Robolectric; dass der Verlauf
 * für beide Arten geladen wird, KaeufeViewModelTest (core-zustand) am ViewModel.
 */
class ManuelleKachelTest {

    private fun read(rel: String) =
        File(Quellen.wurzel, "$rel").readText()
    private fun code(s: String) = s.lines()
        .joinToString("\n") { if (it.trim().startsWith("//") || it.trim().startsWith("*")) "" else it }

    @Test
    fun `der mengengewichtete Kaufpreis kommt vom Server`() {
        // `unit_price` in der Stammzeile ist nur der ZULETZT geschriebene
        // Einzelpreis. Wer einmal fuer 2.- und einmal fuer 8.- gekauft hat,
        // saehe dort 8.- statt 5.-. Der Server rechnet es richtig
        // (utils/handlers/shared.ts) — die App las das Feld nur nicht ein.
        val teil = ApiJson.decodeFromString(PartValuationItem.serializer(),
            """{"part_number":"3001","unit_price":8.0,"avg_purchase_price":5.0}""")
        val figur = ApiJson.decodeFromString(FigValuationItem.serializer(),
            """{"fig_number":"sw0001","unit_price":8.0,"avg_purchase_price":5.0}""")
        assertEquals(5.0, teil.avgPurchasePrice ?: 0.0, 0.0)
        assertEquals(5.0, figur.avgPurchasePrice ?: 0.0, 0.0)
    }

    // Die Wert-Kacheln wie im Set-Detail; eine grosse Preiszeile in der Marktpreis-Karte
    // wiederholte sie (lag bis hierher in PurchasePriceDisplayTest, core-data).
    @Test
    fun `die Detailansicht zeigt Wert-Kacheln, Marktpreis und Preisverlauf, ohne grosse Preiszeile`() {
        val s = code(read("teile/ui/screens/ManualItemDetailScreen.kt"))
        for (teil in listOf("WertKacheln(", "MarketPriceByCondition(", "PriceChart(")) {
            assert(s.contains(teil)) { "$teil fehlt in der Detailansicht" }
        }
        assert(!s.contains("headlineSmall")) { "wieder eine grosse Preiszeile neben den Kacheln" }
    }
}
