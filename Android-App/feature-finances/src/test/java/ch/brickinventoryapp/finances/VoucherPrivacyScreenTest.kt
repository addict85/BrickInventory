package ch.brickinventoryapp.finances

import ch.brickinventoryapp.finances.ui.viewmodel.voucherExportAddress
import ch.brickinventoryapp.finances.ui.viewmodel.voucherPdfAddress
import ch.brickinventoryapp.finances.ui.viewmodel.showsVouchers
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import ch.brickinventoryapp.testing.Sources

/**
 * The number and PIN of vouchers do not appear in screenshots and not
 * in the app overview's preview image (FLAG_SECURE).
 *
 * Run: which PDF addresses need the protection. That the vouchers page and
 * a voucher PDF really set the flag is checked by VoucherPrivacyScreenDisplayTest (app,
 * Robolectric).
 *
 * Counter-checks:
 *   A  showsVouchers() checks "/vouchers/export" instead of "/api/v1/vouchers/" → red
 *      “a single voucher and the export need a privacy screen”
 *   C  PrivacyShield() removed from the branch `secondFactorUiState.secret != null` in
 *      EinstellungenZweiterFaktor → red “second-factor keys and codes …”
 */
class VoucherPrivacyScreenTest {

    @Test
    fun `a single voucher and the export need a privacy screen`() {
        assertTrue(showsVouchers(voucherPdfAddress("https://brick.example/", 7)))
        assertTrue(showsVouchers(voucherExportAddress("https://brick.example")))
    }

    @Test
    fun `a building instruction needs none`() {
        assertFalse(showsVouchers("https://brick.example/api/v1/instructions/42/file"))
    }

    /** The same rule for the TOTP key and the recovery codes. */
    @Test
    fun `key and codes of the second factor request the privacy screen`() {
        val account = Sources.withoutComments(Sources.read("account/ui/screens/SettingsSecondFactor.kt"))
        for (branch in listOf("secondFactorUiState.codes.isNotEmpty() ->", "secondFactorUiState.secret != null ->")) {
            assertTrue("Ohne Sichtschutz: $branch", Regex(Regex.escape(branch) +
                """\s*\{\s*(?:ch\.brickinventoryapp\.ui\.components\.)?PrivacyShield\(\)""").containsMatchIn(account))
        }
    }
}
