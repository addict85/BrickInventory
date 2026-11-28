package ch.brickinventoryapp.contract

import ch.brickinventoryapp.model.json.BrickJson
import kotlinx.serialization.SerializationException
import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Test

/**
 * A field the contract requires has no default in the generated responses: if the server leaves
 * it out, reading fails instead of showing 0, false or "" as if the server had said so.
 * Optional fields still read as their empty value.
 *
 * Counter-check (counter-checks/strict-required-field-default.patch): in ContractVouchers.kt
 * `Voucher.amount` gets `= 0.0` again → red “a voucher without amount is not read as zero”.
 */
class StrictResponseTest {

    @Test
    fun `a voucher without amount is not read as zero`() {
        val withoutAmount = """{"success":true,"total":1,"page":1,"page_size":50,"vouchers":[{"id":1,"number":"…3456","pin":null,
            "currency":"CHF","has_pdf":false,"created_at":"2026-01-01","updated_at":"2026-01-01","balance_checked_at":null}]}"""
        assertThrows(SerializationException::class.java) { BrickJson.decodeFromString<VoucherList>(withoutAmount) }
        val complete = withoutAmount.replace("\"id\":1,", "\"id\":1,\"amount\":12.5,")
        assertEquals(12.5, BrickJson.decodeFromString<VoucherList>(complete).vouchers.single().amount, 0.0)
    }

    @Test
    fun `a required nullable field must be present, its value may be null`() {
        assertThrows(SerializationException::class.java) {
            BrickJson.decodeFromString<QuantityChanged>("""{"success":true}""")
        }
        assertEquals(null, BrickJson.decodeFromString<QuantityChanged>("""{"success":true,"quantity":null}""").quantity)
    }

    @Test
    fun `a missing optional field reads as its empty value`() {
        val r = BrickJson.decodeFromString<QuantityChanged>("""{"success":true,"quantity":3}""")
        assertEquals(0, r.trash)
        assertEquals(emptyList<String>(), r.degraded)
    }
}
