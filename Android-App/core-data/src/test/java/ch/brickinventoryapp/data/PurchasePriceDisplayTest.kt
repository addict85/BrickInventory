package ch.brickinventoryapp.data

import ch.brickinventoryapp.data.api.ApiJson
import ch.brickinventoryapp.model.data.model.SetItem
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File
import ch.brickinventoryapp.testing.Quellen

/**
 * Beide Clients zeigen denselben Kaufpreis: den MENGENGEWICHTETEN.
 *
 * ── Woher dieser Test kommt (Marcos Befund, Nachtrag 76) ────────────────────
 * „In der Android-App wird der Kaufpreis des gebrauchten Sets angezeigt, in der
 * Webapp der gewichtete Durchschnittspreis. Beide sollen den gewichteten
 * Durchschnitt zeigen."
 *
 * Der Server rechnet ihn längst und liefert ihn auf BEIDEN Wegen als
 * `avg_purchase_price` (nachgemessen: 2×7.41 + 1×9.48 → 8.10 in Liste UND
 * Detail). Die Webapp nutzt das Feld seit jeher. Nur die Kachel der App las
 * `purchase_price` — und das war bloss der in die sets-Zeile gespiegelte Wert
 * der NEUESTEN Erfassung, also der letzte Kauf statt der Sammlung.
 *
 * Die Regel steht jetzt EINMAL im Modell (`anzeigeKaufpreis`) statt in jeder
 * Ansicht. Genau darum geht es: nicht „an zwei Stellen dasselbe hinschreiben",
 * sondern eine Stelle, die beide Ansichten benutzen.
 *
 * ── Was Migration 0032 daran geändert hat ───────────────────────────────────
 * Die gespiegelte Spalte ist weg, und mit ihr das Feld `purchasePrice` an
 * SetItem. `anzeigeKaufpreis` hat deshalb keinen Rückfall mehr. Die Prüfung
 * darauf ist umgedreht: Das Modell darf das Feld NICHT wieder einführen, denn
 * es käme ab jetzt immer leer vom Server — und ein leerer Rückfall hinter
 * einem gefüllten Wert fällt niemandem auf, bis der gefüllte einmal fehlt.
 */
class PurchasePriceDisplayTest {

    private fun read(rel: String) =
        File(Quellen.wurzel, "$rel").readText()
    private fun code(s: String) = s.lines()
        .joinToString("\n") { if (it.trim().startsWith("//") || it.trim().startsWith("*")) "" else it }

    // Gegenproben: anzeigeKaufpreis auf maxPurchasePrice gestellt → rot „die Anzeigeregel …“;
    // gegenproben/setitem-liest-purchase-price.patch (das Feld zurück in SetItem) → rot, derselbe Test.
    @Test
    fun `die Anzeigeregel steht im Modell und bevorzugt den Durchschnitt`() {
        val set = ApiJson.decodeFromString(SetItem.serializer(),
            """{"set_number":"75192-1","avg_purchase_price":712.5,"max_purchase_price":800,"purchase_price":99}""")
        assertEquals("Der mengengewichtete Wert, nie der alte gespiegelte", 712.5, set.anzeigeKaufpreis!!, 1e-9)
        // Was SetItem aus der Antwort liest: purchase_price kommt seit Migration 0032 immer
        // leer und darf nicht wieder als Feld auftauchen; in den ANFRAGEN ist es richtig.
        val felder = (0 until SetItem.serializer().descriptor.elementsCount)
            .map { SetItem.serializer().descriptor.getElementName(it) }
        assertTrue("avg_purchase_price fehlt in SetItem", "avg_purchase_price" in felder)
        assertFalse("SetItem liest purchase_price wieder", "purchase_price" in felder)
    }

    @Test
    fun `die Detailansicht liest nicht mehr direkt den gespiegelten Wert`() {
        // SetDetailScreen.kt wurde aufgeteilt; die Kacheln und Karten stehen
        // in SetDetailSections.kt. Beide zusammen sind die Detailansicht.
        val d = code(read("sammlung/ui/screens/SetDetailScreen.kt") + "\n" + read("sammlung/ui/screens/SetDetailSections.kt") +
            "\n" + read("sammlung/ui/screens/SetDetailAnleitungen.kt"))
        assert(!d.contains("fmtPrice(set.purchasePrice)")) {
            "Die Kaufpreis-Kachel liest wieder set.purchasePrice — das ist der Preis des " +
                "LETZTEN Kaufs, nicht der Sammlung"
        }
        assert(d.contains("set.anzeigeKaufpreis")) {
            "Die Kachel nutzt die gemeinsame Anzeigeregel nicht"
        }
    }

    @Test
    fun `die Marktpreis-Karte wiederholt die Wert-Kacheln nicht`() {
        // Markt-, Kaufpreis und G&V stehen in jedem Design in den Wert-Kacheln oben. Eine
        // grosse Preiszeile in der Marktpreis-Karte wiederholte sie, mit einer
        // Prozentangabe aus dem Gesamtvergleich über den Zeilen je Zustand. Beide
        // Detailseiten (Set und manueller Eintrag) halten sich gleich daran.
        val d = code(read("sammlung/ui/screens/SetDetailScreen.kt") + "\n" + read("sammlung/ui/screens/SetDetailSections.kt") +
            "\n" + read("sammlung/ui/screens/SetDetailAnleitungen.kt"))
        val m = code(read("teile/ui/screens/ManualItemDetailScreen.kt"))
        for ((name, src) in listOf("Set-Detail" to d, "manueller Eintrag" to m)) {
            assert(src.contains("WertKacheln(")) { "$name: Die Wert-Kacheln fehlen" }
            assert(!src.contains("headlineSmall")) { "$name: wieder eine grosse Preiszeile neben den Kacheln" }
        }
    }
}
