package ch.brickinventoryapp

import org.junit.Test

/**
 * Doppelerfassung beim Barcode-Hinzufügen.
 *
 * Nutzerbeobachtung: "Da der Dialog träge reagiert wird oft 2x geklickt was
 * dazu führt, dass dann das Set doppelt erfasst wird."
 *
 * Die naheliegende Reparatur — `enabled` am Knopf — reicht allein **nicht**:
 * Sie greift erst, wenn Compose rekomponiert hat, und genau diese
 * Rekomposition ist die träge Stelle. Zwischen dem ersten Tippen und dem
 * gesperrten Knopf liegt ein Fenster, in dem der zweite Tipp durchkommt.
 *
 * Verbindlich ist deshalb die Sperre im ViewModel; sie wird ausgeführt
 * geprüft (ErfassungViewModelTest, „ein zweiter Klick auf Bestätigen …“).
 * Hier bleibt die Struktur: das Feld im Zustand und der gesperrte Knopf als
 * sichtbare Rückmeldung.
 */
class BarcodeDoubleAddGuardTest {

    private fun read(rel: String): String {
        val f = java.io.File("src/main/java/ch/brickinventoryapp/$rel")
        assert(f.exists()) { "Datei nicht gefunden: $rel" }
        return f.readText()
    }

    /**
     * Kommentare ausblenden — die Erklärtexte oben nennen die geprüften
     * Muster selbst und würden den Test sonst grün färben, ohne dass der
     * Code sie enthält.
     */
    private fun code(src: String): String {
        val withoutBlocks = src.replace(Regex("""/\*.*?\*/""", RegexOption.DOT_MATCHES_ALL), "")
        return withoutBlocks.lines()
            .filterNot { it.trim().startsWith("//") }
            .joinToString("\n")
    }

    @Test
    fun `BarcodeUiState kennt das adding-Flag`() {
        val src = code(read("ui/UiState.kt"))
        assert(Regex("""val\s+adding\s*:\s*Boolean""").containsMatchIn(src)) {
            "BarcodeUiState.adding fehlt — ohne das Flag gibt es keine Sperre " +
                "gegen den zweiten Klick im Barcode-Dialog"
        }
    }

    @Test
    fun `der Knopf im Dialog ist waehrend des Hinzufuegens gesperrt`() {
        // Der Barcode-Dialog steht seit seiner Auslagerung in
        // ui/dialogs/BarcodeResultDialog.kt; AppNavigation.kt ruft ihn nur noch
        // auf. Gelesen werden BEIDE Dateien, damit die Regel dort gefunden
        // wird, wo sie heute steht.
        val src = code(read("AppNavigation.kt") + "\n" + read("ui/dialogs/BarcodeResultDialog.kt"))
        assert(src.contains("enabled = !barcodeState.adding")) {
            "Der Bestätigen-Knopf des Barcode-Dialogs wird nicht gesperrt — " +
                "der Nutzer bekommt kein Feedback und tippt weiter"
        }
        assert(Regex("""onDismissRequest\s*=\s*\{\s*if\s*\(!barcodeState\.adding\)""").containsMatchIn(src)) {
            "Der Barcode-Dialog lässt sich während des laufenden Hinzufügens " +
                "durch Tippen daneben schliessen"
        }
    }

    /**
     * Die untere Leiste: genau die fünf Ziele der Webapp in deren Folge
     * (Merkliste vor Katalog). Material sieht höchstens fünf Reiter vor; der
     * Vergleich steht im Konto-Menü (ErreichbareRoutenTest prüft den Weg).
     */
    @Test
    fun `die Leiste folgt der Webapp mit fuenf Zielen`() {
        val src = code(read("AppNavigation.kt"))
        val ziele = Regex("""add\(Triple\(Screen\.(\w+)""").findAll(src).map { it.groupValues[1] }.toList()
        assert(ziele == listOf("Gallery", "PartsList", "Finance", "Wanted", "Catalog")) {
            "Die Leiste zeigt $ziele — erwartet: die fünf Ziele der Webapp"
        }
    }
}
