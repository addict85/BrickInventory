package ch.brickinventoryapp.finances

import ch.brickinventoryapp.finances.ui.screens.VoucherField.AMOUNT
import ch.brickinventoryapp.finances.ui.screens.VoucherField.NUMMER
import ch.brickinventoryapp.finances.ui.screens.voucherError
import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * Was „Speichern“ im Gutscheinformular markiert, bevor etwas hinausgeht; das erste Feld
 * bekommt den Cursor. Mit PDF liest der Server, was leer ist.
 *
 * Gegenprobe (gemessen lokal, JVM):
 *   gutschein-pdf-verlangt-nummer  Nummer auch mit PDF Pflicht → rot „mit PDF …“
 */
class VoucherFormCheckTest {

    @Test
    fun `ohne PDF fehlen leere Nummer und Betrag, in dieser Reihenfolge`() {
        assertEquals(listOf(NUMMER, AMOUNT), voucherError("", "", withPdf = false))
        assertEquals(listOf(AMOUNT), voucherError("6061 2345", "zwanzig", withPdf = false))
        assertEquals(emptyList<Any>(), voucherError("6061 2345", "20,50", withPdf = false))
    }

    @Test
    fun `mit PDF darf leer bleiben, was der Server liest, ein unlesbarer Betrag nicht`() {
        assertEquals(emptyList<Any>(), voucherError("", "", withPdf = true))
        assertEquals(listOf(AMOUNT), voucherError("", "1.2.3", withPdf = true))
    }
}
