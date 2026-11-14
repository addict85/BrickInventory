package ch.brickinventoryapp.data

import ch.brickinventoryapp.model.json.BrickJson
import ch.brickinventoryapp.vertrag.SetItem
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Beide Clients zeigen denselben Kaufpreis: den MENGENGEWICHTETEN `avg_purchase_price`
 * des Servers, nicht den Preis der neuesten Erfassung. Die Regel steht einmal im Modell
 * (`anzeigeKaufpreis`), damit keine Ansicht ein anderes Feld liest; `purchasePrice` an
 * SetItem darf nicht zurückkommen, weil es immer leer vom Server käme. Was die Detailansicht
 * daraus zeichnet, prüft SetDetailAnzeigeTest (feature-sammlung) unter Robolectric.
 */
class PurchasePriceDisplayTest {

    // Gegenproben: anzeigeKaufpreis auf maxPurchasePrice gestellt → rot „die Anzeigeregel …“;
    // gegenproben/setitem-liest-purchase-price.patch (das Feld zurück in SetItem) → rot, derselbe Test.
    @Test
    fun `die Anzeigeregel steht im Modell und bevorzugt den Durchschnitt`() {
        val set = BrickJson.decodeFromString(SetItem.serializer(),
            """{"set_number":"75192-1","avg_purchase_price":712.5,"max_purchase_price":800,"purchase_price":99}""")
        assertEquals("Der mengengewichtete Wert, nie der alte gespiegelte", 712.5, set.anzeigeKaufpreis!!, 1e-9)
        // Was SetItem aus der Antwort liest: purchase_price kommt seit Migration 0032 immer
        // leer und darf nicht wieder als Feld auftauchen; in den ANFRAGEN ist es richtig.
        val felder = (0 until SetItem.serializer().descriptor.elementsCount)
            .map { SetItem.serializer().descriptor.getElementName(it) }
        assertTrue("avg_purchase_price fehlt in SetItem", "avg_purchase_price" in felder)
        assertFalse("SetItem liest purchase_price wieder", "purchase_price" in felder)
    }
}
