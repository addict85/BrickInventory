package ch.brickinventoryapp

import ch.brickinventoryapp.ui.viewmodel.gutscheinExportAdresse
import ch.brickinventoryapp.ui.viewmodel.gutscheinPdfAdresse
import ch.brickinventoryapp.ui.viewmodel.zeigtGutscheine
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Nummer und PIN der Gutscheine erscheinen nicht auf Bildschirmfotos und nicht
 * im Vorschaubild der App-Übersicht (FLAG_SECURE).
 *
 * Ausgeführt: welche PDF-Adressen den Schutz brauchen. Das Setzen des Flags
 * selbst braucht ein Gerät; die Struktur-Prüfung unten hält fest, dass beide
 * Bildschirme ihn anfordern.
 *
 * Gegenproben (29.10.2026, gemessen):
 *   A  zeigtGutscheine() prüft "/vouchers/export" statt "/api/v1/vouchers/" → rot
 *      „ein einzelner Gutschein und der Export brauchen Sichtschutz“
 *   B  Sichtschutz() aus GutscheineUnterseite entfernt → rot „Gutscheinseite und
 *      Gutschein-PDF fordern den Sichtschutz an“
 *   C  (01.11.2026) Sichtschutz() aus dem Zweig `zfZustand.geheimnis != null` in
 *      EinstellungenKonto entfernt → rot „Schlüssel und Codes des zweiten Faktors …“
 *   D  (03.11.2026, kotlinc lokal) Ueberdeckungsschutz() aus GutscheineUnterseite
 *      entfernt → rot „Gutscheinseite und Gutschein-PDF fordern den Sichtschutz an“
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

    @Test
    fun `Gutscheinseite und Gutschein-PDF fordern den Sichtschutz an`() {
        val seite = Quellen.funktion(Quellen.ohneKommentare(Quellen.lies("ui/screens/GutscheineUnterseite.kt")),
            "fun GutscheineRoute(")
        assertTrue("Die Gutscheinseite setzt keinen Sichtschutz", seite.contains("Sichtschutz()"))
        // Kopieren der PIN und Löschen: kein Tipp durch ein fremdes Fenster (Android 8 bis 11).
        assertTrue("Die Gutscheinseite setzt keinen Überdeckungsschutz", seite.contains("Ueberdeckungsschutz()"))
        val graph = Quellen.ohneKommentare(Quellen.lies("nav/ToolsGraph.kt"))
        assertTrue("Das Gutschein-PDF setzt keinen Sichtschutz",
            Regex("""zeigtGutscheine\(ziel\.url\)\)\s*ch\.brickinventoryapp\.ui\.components\.Sichtschutz\(\)""").containsMatchIn(graph))
    }

    /** Dieselbe Regel für den TOTP-Schlüssel und die Wiederherstellungscodes. */
    @Test
    fun `Schluessel und Codes des zweiten Faktors fordern den Sichtschutz an`() {
        val konto = Quellen.ohneKommentare(Quellen.lies("ui/screens/EinstellungenKonto.kt"))
        for (zweig in listOf("zfZustand.codes.isNotEmpty() ->", "zfZustand.geheimnis != null ->")) {
            assertTrue("Ohne Sichtschutz: $zweig", Regex(Regex.escape(zweig) +
                """\s*\{\s*ch\.brickinventoryapp\.ui\.components\.Sichtschutz\(\)""").containsMatchIn(konto))
        }
    }
}
