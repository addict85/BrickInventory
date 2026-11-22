package ch.brickinventoryapp.data

import ch.brickinventoryapp.contract.Gutschein
import ch.brickinventoryapp.contract.mapping.asView
import ch.brickinventoryapp.data.finances.VouchersRepositoryImpl
import ch.brickinventoryapp.model.domain.Money
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/**
 * What of a voucher goes into the offline store: no PIN, of the number only the last four.
 *
 * Counter-check: in VouchersRepositoryImpl.withoutSecret `pin = null` removed → red
 * “a voucher lies without PIN and full number”.
 */
class VoucherWithoutSecretTest {

    @Test
    fun `a voucher lies without PIN and full number`() {
        val g = VouchersRepositoryImpl.withoutSecret(Gutschein(id = 1, number = "1234567890123456", pin = "4711", amount = 50.0).asView())
        assertEquals("…3456", g.number)
        assertNull(g.pin)
        assertEquals(Money.from(50.0), g.amount)
    }
}
