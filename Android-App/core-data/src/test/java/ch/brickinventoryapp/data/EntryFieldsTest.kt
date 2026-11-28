package ch.brickinventoryapp.data

import ch.brickinventoryapp.contract.AcquisitionsResponse
import ch.brickinventoryapp.contract.testing.decodeCompleted
import ch.brickinventoryapp.model.domain.CurrencyCode
import ch.brickinventoryapp.model.json.BrickJson
import kotlinx.serialization.SerializationException
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The app reads the estimate flag and currency of an acquisition as the
 * server sends them (GET …/acquisitions, migration 0047).
 *
 * The fields are required: a server without them is refused instead of the purchase
 * counting as paid.
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
        val r = decodeCompleted(AcquisitionsResponse.serializer(), response)
        assertTrue(r.acquisitions[0].priceEstimated)
        assertEquals(CurrencyCode.CHF, r.acquisitions[0].currency)
        assertFalse(r.acquisitions[1].priceEstimated)
        assertEquals(CurrencyCode.EUR, r.acquisitions[1].currency)
    }

    @Test
    fun `an acquisition without the estimate flag is refused, not counted as paid`() {
        val withoutFlag = response.replace("\"price_estimated\":true,", "")
        assertThrows(SerializationException::class.java) { BrickJson.decodeFromString(AcquisitionsResponse.serializer(), withoutFlag) }
    }
}
