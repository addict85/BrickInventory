package ch.brickinventoryapp.data

import ch.brickinventoryapp.contract.AcquisitionsResponse
import ch.brickinventoryapp.contract.testing.decodeCompleted
import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * The surfaces do not calculate — they display. Totals and key figures come from the
 * server's response, not from a loop over a (possibly filtered) list;
 * otherwise web app and app would show different numbers from the same data.
 *
 * Here the response carries the total; that the screens show it runs in the app's
 * ServerTotalsDisplayTest.
 */
class ServerComputedValuesTest {

    /**
     * Executed with the app's Json. Counter-check: `@SerialName("totals")` renamed → red
     * (the required field is missing, reading fails).
     */
    @Test
    fun `the response carries the total`() {
        val newValue = decodeCompleted(AcquisitionsResponse.serializer(),
            """{"success":true,"acquisitions":[],"totals":{"quantity":3,"amount":42.5,"priced_rows":2}}""")
        assertEquals(3, newValue.totals.quantity)
        assertEquals(42.5, newValue.totals.amount ?: 0.0, 0.0)
    }
}
