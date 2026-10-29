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
        val seite = Quellen.funktion(Quellen.ohneKommentare(Quellen.lies("ui/screens/EinstellungenUnterseiten.kt")),
            "fun GutscheineUnterseite(")
        assertTrue("Die Gutscheinseite setzt keinen Sichtschutz", seite.contains("Sichtschutz()"))
        val graph = Quellen.ohneKommentare(Quellen.lies("nav/ToolsGraph.kt"))
        assertTrue("Das Gutschein-PDF setzt keinen Sichtschutz",
            Regex("""zeigtGutscheine\(pdfUrl\)\)\s*ch\.brickinventoryapp\.ui\.components\.Sichtschutz\(\)""").containsMatchIn(graph))
    }
}
