package ch.brickinventoryapp.finances

import ch.brickinventoryapp.finances.ui.screens.VoucherField.AMOUNT
import ch.brickinventoryapp.finances.ui.screens.VoucherField.NUMBER
import ch.brickinventoryapp.finances.ui.screens.voucherError
import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * What „Speichern“ marks in the voucher form before anything goes out; the first field
 * gets the cursor. With a PDF the server reads what is empty.
 *
 * Counter-check (measured locally, JVM):
 *   gutschein-pdf-verlangt-nummer  the number mandatory even with a PDF → red “with a PDF …”
 */
class VoucherFormCheckTest {

    @Test
    fun `without PDF empty number and amount are missing, in this order`() {
        assertEquals(listOf(NUMBER, AMOUNT), voucherError("", "", withPdf = false))
        assertEquals(listOf(AMOUNT), voucherError("6061 2345", "zwanzig", withPdf = false))
        assertEquals(emptyList<Any>(), voucherError("6061 2345", "20,50", withPdf = false))
    }

    @Test
    fun `with PDF what the server reads may stay empty, an unreadable amount may not`() {
        assertEquals(emptyList<Any>(), voucherError("", "", withPdf = true))
        assertEquals(listOf(AMOUNT), voucherError("", "1.2.3", withPdf = true))
    }
}
