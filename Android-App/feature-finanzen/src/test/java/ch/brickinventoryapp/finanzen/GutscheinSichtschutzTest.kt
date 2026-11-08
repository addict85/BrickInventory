package ch.brickinventoryapp.finanzen

import ch.brickinventoryapp.finanzen.ui.viewmodel.gutscheinExportAdresse
import ch.brickinventoryapp.finanzen.ui.viewmodel.gutscheinPdfAdresse
import ch.brickinventoryapp.finanzen.ui.viewmodel.zeigtGutscheine
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import ch.brickinventoryapp.testing.Quellen

/**
 * Nummer und PIN der Gutscheine erscheinen nicht auf Bildschirmfotos und nicht
 * im Vorschaubild der App-Übersicht (FLAG_SECURE).
 *
 * Ausgeführt: welche PDF-Adressen den Schutz brauchen. Dass Gutscheinseite und
 * Gutschein-PDF das Flag wirklich setzen, prüft GutscheinSichtschutzAnzeigeTest (app,
 * Robolectric).
 *
 * Gegenproben:
 *   A  zeigtGutscheine() prüft "/vouchers/export" statt "/api/v1/vouchers/" → rot
 *      „ein einzelner Gutschein und der Export brauchen Sichtschutz“
 *   C  Sichtschutz() aus dem Zweig `zfZustand.geheimnis != null` in
 *      EinstellungenKonto entfernt → rot „Schlüssel und Codes des zweiten Faktors …“
 */
class GutscheinSichtschutzTest {

    @Test
    fun `ein einzelner Gutschein und der Export brauchen Sichtschutz`() {
        assertTrue(zeigtGutscheine(gutscheinPdfAdresse("https://brick.example/", 7)))
        assertTrue(zeigtGutscheine(gutscheinExportAdresse("https://brick.example")))
    }

    @Test
    fun `eine Bauanleitung braucht keinen`() {
        assertFalse(zeigtGutscheine("https://brick.example/api/v1/instructions/42/file"))
    }

    /** Dieselbe Regel für den TOTP-Schlüssel und die Wiederherstellungscodes. */
    @Test
    fun `Schluessel und Codes des zweiten Faktors fordern den Sichtschutz an`() {
        val konto = Quellen.ohneKommentare(Quellen.lies("konto/ui/screens/EinstellungenKonto.kt"))
        for (zweig in listOf("zfZustand.codes.isNotEmpty() ->", "zfZustand.geheimnis != null ->")) {
            assertTrue("Ohne Sichtschutz: $zweig", Regex(Regex.escape(zweig) +
                """\s*\{\s*(?:ch\.brickinventoryapp\.ui\.components\.)?Sichtschutz\(\)""").containsMatchIn(konto))
        }
    }
}
