package ch.brickinventoryapp.finances

import ch.brickinventoryapp.finances.ui.viewmodel.showsVouchers
import ch.brickinventoryapp.finances.ui.viewmodel.voucherExportAddress
import ch.brickinventoryapp.finances.ui.viewmodel.voucherPdfAddress
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The number and PIN of vouchers do not appear in screenshots and not
 * in the app overview's preview image (FLAG_SECURE).
 *
 * Run: which PDF addresses need the protection. That the vouchers page and
 * a voucher PDF really set the flag is checked by VoucherPrivacyScreenDisplayTest (app,
 * Robolectric).
 *
 * Counter-checks:
 *   A  showsVouchers() checks "/vouchers/export" instead of "/api/v2/vouchers/" → red
 *      “a single voucher and the export need a privacy screen”
 *   B  "v1" removed from API_VERSIONS → red “an address of the v1 alias …”
 */
class VoucherPrivacyScreenTest {

    @Test
    fun `a single voucher and the export need a privacy screen`() {
        assertTrue(showsVouchers(voucherPdfAddress("https://brick.example/", 7)))
        assertTrue(showsVouchers(voucherExportAddress("https://brick.example")))
    }

    @Test
    fun `an address of the v1 alias still needs a privacy screen`() {
        assertTrue(showsVouchers("https://brick.example/api/v1/vouchers/7/pdf"))
    }

    @Test
    fun `a building instruction needs none`() {
        assertFalse(showsVouchers("https://brick.example/api/v2/instructions/42/file"))
    }
}
