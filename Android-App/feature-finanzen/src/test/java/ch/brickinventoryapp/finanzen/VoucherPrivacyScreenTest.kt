package ch.brickinventoryapp.finanzen

import ch.brickinventoryapp.finanzen.ui.viewmodel.voucherExportAddress
import ch.brickinventoryapp.finanzen.ui.viewmodel.voucherPdfAddress
import ch.brickinventoryapp.finanzen.ui.viewmodel.showsVouchers
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
 *      „ein einzelner Gutschein und der Export brauchen Sichtschutz“
 *   C  Sichtschutz() aus dem Zweig `zfZustand.geheimnis != null` in
 *      EinstellungenZweiterFaktor entfernt → rot „Schlüssel und Codes des zweiten Faktors …“
 */
class VoucherPrivacyScreenTest {

    @Test
    fun `ein einzelner Gutschein und der Export brauchen Sichtschutz`() {
        assertTrue(showsVouchers(voucherPdfAddress("https://brick.example/", 7)))
        assertTrue(showsVouchers(voucherExportAddress("https://brick.example")))
    }

    @Test
    fun `eine Bauanleitung braucht keinen`() {
        assertFalse(showsVouchers("https://brick.example/api/v1/instructions/42/file"))
    }

    /** Dieselbe Regel für den TOTP-Schlüssel und die Wiederherstellungscodes. */
    @Test
    fun `Schluessel und Codes des zweiten Faktors fordern den Sichtschutz an`() {
        val konto = Quellen.withoutComments(Quellen.lies("konto/ui/screens/EinstellungenZweiterFaktor.kt"))
        for (branch in listOf("zfZustand.codes.isNotEmpty() ->", "zfZustand.geheimnis != null ->")) {
            assertTrue("Ohne Sichtschutz: $branch", Regex(Regex.escape(branch) +
                """\s*\{\s*(?:ch\.brickinventoryapp\.ui\.components\.)?Sichtschutz\(\)""").containsMatchIn(konto))
        }
    }
}
