package ch.brickinventoryapp

import org.junit.Test
import java.io.File

/**
 * Testdateien, die nur Quelltext lesen, werden weniger, nie mehr.
 *
 * Eine Regex auf den Quelltext bestätigt, dass eine Zeile dasteht — nicht,
 * dass sie an der richtigen Stelle steht und wirkt. Neue Prüfungen von
 * Verhalten führen den Code aus (TestDienste, PfadServer, die ViewModels);
 * Quelltext-Prüfungen bleiben für Struktur. Gegenstück zu
 * Web-App/test/ratschen.test.js.
 *
 * „Liest Quelltext": Quellen.*, ein Pfad unter src/main, der Workflow oder die
 * Ressourcen. „Führt aus": importiert Code aus einem Unterpaket der App.
 *
 * Gegenproben (29.10.2026, gemessen): SCHRANKE auf 62 → rot mit 63 Dateien;
 * eine zusätzliche Testdatei, die nur Quellen.lies() aufruft → rot mit 64.
 * Stände: 82 vor dem Schnitt des MainViewModels (307ee28), 77 bei 8f4f9d3,
 * 61 seit FinanzZeilenGleichTest und ClientRendersOnlyTest die Finanzwahl ausführen,
 * 59 seit MengePlaketteTest und PurchasePriceDisplayTest die Regel ausführen.
 * 54 seit die Bildadressen, das Katalogmodell, erfassungsWerte und die Teilefilter
 * ausgeführt werden (ThumbFallback-, NoDirectCdnAccess-, CatalogUsesLocalImages-,
 * AddPathOwner-, ListenfilterImZustandTest).
 * 53 seit der Aufteilung in Module: Gezählt wird über die Tests aller Module;
 * ModulgrenzenTest kam als Strukturprüfung dazu, ZustandsflussBreiteTest prüft
 * die übersetzten Klassen, BarcodeDoubleAddGuardTest ging in Verhaltens- und
 * Verdrahtungstests auf.
 */
class QuelltextRatscheTest {

    private val liest = Regex("""Quellen\.|"src/main/|File\("src/main|\.\./\.\./\.github|res/values""")
    private val fuehrtAus = Regex("""^import ch\.brickinventoryapp\.(?!R$|ressourcen\.R$)\w+\.""", RegexOption.MULTILINE)

    @Test
    fun `reine Quelltext-Tests werden weniger, nie mehr`() {
        val SCHRANKE = 53
        // Die Tests aller Module; seit der Aufteilung liegen sie neben ihrem Code.
        val alle = Quellen.tests.walkTopDown().filter { it.isFile && it.name.endsWith("Test.kt") }.toList()
        assert(alle.size >= 100) { "Nur ${alle.size} Testdateien gefunden — greift die Suche noch?" }
        val nur = alle.filter { it.name != "QuelltextRatscheTest.kt" }.filter {
            val s = it.readText()
            liest.containsMatchIn(s) && !fuehrtAus.containsMatchIn(s)
        }
        assert(nur.size <= SCHRANKE) {
            "${nur.size} Testdateien lesen nur Quelltext, erlaubt sind $SCHRANKE. Prüft der " +
                "neue Test Verhalten, soll er den Code ausführen statt per Regex nachzusehen, " +
                "ob eine Zeile dasteht."
        }
        if (nur.size < SCHRANKE) println("  reine Quelltext-Tests: ${nur.size} (Schranke $SCHRANKE) — Schranke nachziehen")
    }
}
