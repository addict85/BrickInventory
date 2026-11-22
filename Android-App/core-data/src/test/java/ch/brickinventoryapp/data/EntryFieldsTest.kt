package ch.brickinventoryapp.data

import ch.brickinventoryapp.model.domain.CurrencyCode
import ch.brickinventoryapp.model.json.BrickJson
import ch.brickinventoryapp.contract.AcquisitionsResponse
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The app reads the estimate flag and currency of an acquisition as the
 * server sends them (GET …/acquisitions, migration 0047).
 *
 * A wrong field name otherwise stands out nowhere: the field has a
 * default value, and BrickJson skips unknown keys.
 *
 * Counter-check (measured 28.10.2026, kotlinc with serialization plugin):
 *   A  @SerialName("price_estimated") changed to "preis_geschaetzt" → red:
 *      “estimate flag and currency arrive"
 */
class EntryFieldsTest {
    private val response = """
        {"success":true,"acquisitions":[
          {"id":7,"quantity":2,"unit_price":3.5,"condition":"U","price_estimated":true,
           "currency":"CHF","created_at":"2026-10-28T08:00:00Z","owner_user_id":3},
          {"id":8,"quantity":1,"unit_price":null,"condition":"N","price_estimated":false,
           "currency":"EUR","created_at":"2026-10-27T08:00:00Z","owner_user_id":3}
        ],"totals":{"quantity":3,"amount":7.0,"priced_rows":1}}
    """.trimIndent()

    @Test
    fun `estimate flag and currency arrive`() {
        val r = BrickJson.decodeFromString(AcquisitionsResponse.serializer(), response)
        assertTrue(r.acquisitions[0].priceEstimated)
        assertEquals(CurrencyCode.CHF, r.acquisitions[0].currency)
        assertFalse(r.acquisitions[1].priceEstimated)
        assertEquals(CurrencyCode.EUR, r.acquisitions[1].currency)
    }

    @Test
    fun `an older server without the fields counts as paid and without currency`() {
        val old = """{"success":true,"acquisitions":[{"id":1,"quantity":1,"purchase_price":10.0}]}"""
        val a = BrickJson.decodeFromString(AcquisitionsResponse.serializer(), old).acquisitions.single()
        assertFalse(a.priceEstimated)
        assertNull(a.currency)
    }
}
