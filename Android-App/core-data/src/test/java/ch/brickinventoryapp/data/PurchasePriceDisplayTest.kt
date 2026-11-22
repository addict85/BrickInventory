package ch.brickinventoryapp.data

import ch.brickinventoryapp.contract.SetItem
import ch.brickinventoryapp.contract.displayPurchasePrice
import ch.brickinventoryapp.model.json.BrickJson
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Both clients show the same purchase price: the server's QUANTITY-WEIGHTED `avg_purchase_price`,
 * not the price of the newest acquisition. The rule stands once in the model
 * (`displayPurchasePrice`), so that no view reads another field; `purchasePrice` on
 * SetItem must not come back, because it would always come empty from the server. What the detail view
 * draws from it is checked by SetDetailDisplayTest (feature-collection) under Robolectric.
 */
class PurchasePriceDisplayTest {

    // Counter-checks: displayPurchasePrice set to maxPurchasePrice → red “the display rule …”;
    // counter-checks/setitem-liest-purchase-price.patch (the field back in SetItem) → red, the same test.
    @Test
    fun `the display rule is in the model and prefers the average`() {
        val set = BrickJson.decodeFromString(SetItem.serializer(),
            """{"set_number":"75192-1","avg_purchase_price":712.5,"max_purchase_price":800,"purchase_price":99}""")
        assertEquals("The quantity-weighted value, never the old mirrored one", 712.5, set.displayPurchasePrice!!, 1e-9)
        // What SetItem reads from the response: purchase_price has always come empty since migration 0032
        // and must not show up as a field again; in the REQUESTS it is right.
        val fields = (0 until SetItem.serializer().descriptor.elementsCount)
            .map { SetItem.serializer().descriptor.getElementName(it) }
        assertTrue("avg_purchase_price missing in SetItem", "avg_purchase_price" in fields)
        assertFalse("SetItem liest purchase_price wieder", "purchase_price" in fields)
    }
}
