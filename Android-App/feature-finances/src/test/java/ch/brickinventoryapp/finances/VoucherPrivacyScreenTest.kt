package ch.brickinventoryapp.finances

import ch.brickinventoryapp.finances.ui.viewmodel.voucherExportAddress
import ch.brickinventoryapp.finances.ui.viewmodel.voucherPdfAddress
import ch.brickinventoryapp.finances.ui.viewmodel.showsVouchers
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import ch.brickinventoryapp.testing.Quellen

/**
 * Nummer und PIN der Gutscheine erscheinen nicht auf Bildschirmfotos und nicht
 * im Vorschaubild der App-Übersicht (FLAG_SECURE).
 *
 * Ausgeführt: welche PDF-Adressen den Schutz brauchen. Dass Gutscheinseite und
 * Gutschein-PDF das Flag wirklich setzen, prüft VoucherPrivacyScreenDisplayTest (app,
 * Robolectric).
 *
 * Gegenproben:
 *   A  showsVouchers() prüft "/vouchers/export" statt "/api/v1/vouchers/" → rot
 *      „a single voucher and the export need a privacy screen“
 *   C  Sichtschutz() aus dem Zweig `zfZustand.geheimnis != null` in
 *      EinstellungenZweiterFaktor entfernt → rot „Schlüssel und Codes des zweiten Faktors …“
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

    /** Dieselbe Regel für den TOTP-Schlüssel und die Wiederherstellungscodes. */
    @Test
    fun `key and codes of the second factor request the privacy screen`() {
        val konto = Quellen.withoutComments(Quellen.lies("account/ui/screens/EinstellungenZweiterFaktor.kt"))
        for (branch in listOf("zfZustand.codes.isNotEmpty() ->", "zfZustand.geheimnis != null ->")) {
            assertTrue("Ohne Sichtschutz: $branch", Regex(Regex.escape(branch) +
                """\s*\{\s*(?:ch\.brickinventoryapp\.ui\.components\.)?Sichtschutz\(\)""").containsMatchIn(konto))
        }
    }
}
