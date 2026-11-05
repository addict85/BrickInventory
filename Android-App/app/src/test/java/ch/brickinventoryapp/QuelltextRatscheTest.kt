package ch.brickinventoryapp

import org.junit.Test

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
 * Ressourcen. „Führt aus": ruft Code der App auf — runTest/runBlocking, ein
 * Robolectric- oder Compose-Lauf oder der Aufruf einer Klasse bzw. Funktion aus
 * src/main. Ein Import allein zählt nicht: KatalogSprungEntprelltTest importierte
 * eine Konstante und galt so als Verhaltenstest (arch14 N4).
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
 * 54 seit „führt aus“ am Aufruf statt am Import hängt (arch14 N4); gezählt wird
 * strenger, KatalogSprungEntprelltTest zählt weiter als ausführend (er rechnet).
 * Gegenprobe (05.11.2026, gemessen mit kotlinc lokal): ein Import gilt wieder als
 * Ausführen (gegenproben/ratsche-import-zaehlt.patch) → rot „ein Import allein …“.
 *
 * Kommentare (05.11.2026, gemessen mit kotlinc lokal):
 *   kommentar-zu-lang    sechs Zeilen Prosa über AppViewModel → rot „kein Kommentar hat …“
 *   verweis-ins-leere    ein Anker in Vorwaermen.kt verschrieben → rot „jeder Verweis …“
 */
class QuelltextRatscheTest {

    private val liest = Regex("""Quellen\.|"src/main/|File\("src/main|\.\./\.\./\.github|res/values""")
    private val laeuft = Regex("""\brunTest\b|\brunBlocking\b|@RunWith\(|\bcreate(?:Android)?ComposeRule\b""")
    private val deklaration = Regex("""^(?:(?:private|internal|public|data|sealed|abstract|open|enum|inline|suspend|fun)\s+)*(?:class|object|interface|fun)\s+(?:<[^>]*>\s*)?(?:\w+\.)?(\w+)""", RegexOption.MULTILINE)
    private val zeichenkette = Regex("\"\"\"[\\s\\S]*?\"\"\"|\"(?:\\\\.|[^\"\\\\\n])*\"")

    /** Was die App deklariert (ohne core-testing, dessen Hilfen keine App sind). */
    private val produktiv: Set<String> by lazy {
        Quellen.alle().filterNot { it.invariantSeparatorsPath.endsWith("/Quellen.kt") || it.name == "TestApi.kt" }
            .flatMap { f -> deklaration.findAll(Quellen.ohneKommentare(f.readText())).map { it.groupValues[1] } }
            .filter { it.length > 3 }.toSet()
    }

    /** Ohne Kommentare und Zeichenketten: Ein Dateiname wie "GalleryScreen.kt" ist kein Aufruf. */
    private fun code(roh: String) = zeichenkette.replace(Quellen.ohneKommentare(roh), "\"\"")

    private fun fuehrtAus(roh: String): Boolean {
        val c = code(roh)
        if (laeuft.containsMatchIn(c)) return true
        val eigene = Regex("""\b(?:class|object|interface|fun|val|var)\s+(?:<[^>]*>\s*)?(?:\w+\.)?(\w+)""").findAll(c).map { it.groupValues[1] }.toSet()
        return (produktiv - eigene).any { Regex("""(?<![\w.])$it\s*[(.]""").containsMatchIn(c) }
    }

    @Test
    fun `reine Quelltext-Tests werden weniger, nie mehr`() {
        val SCHRANKE = 54
        // Die Tests aller Module; seit der Aufteilung liegen sie neben ihrem Code.
        val alle = Quellen.tests.walkTopDown().filter { it.isFile && it.name.endsWith("Test.kt") }.toList()
        assert(alle.size >= 100) { "Nur ${alle.size} Testdateien gefunden — greift die Suche noch?" }
        assert(produktiv.size >= 300) { "Nur ${produktiv.size} Deklarationen der App gefunden — Muster veraltet?" }
        val nur = alle.filter { it.name != "QuelltextRatscheTest.kt" }.filter {
            val s = it.readText()
            liest.containsMatchIn(s) && !fuehrtAus(s)
        }
        assert(nur.size <= SCHRANKE) {
            "${nur.size} Testdateien lesen nur Quelltext, erlaubt sind $SCHRANKE. Prüft der " +
                "neue Test Verhalten, soll er den Code ausführen statt per Regex nachzusehen, " +
                "ob eine Zeile dasteht.\n  " + nur.joinToString("\n  ") { it.name }
        }
        if (nur.size < SCHRANKE) println("  reine Quelltext-Tests: ${nur.size} (Schranke $SCHRANKE) — Schranke nachziehen")
    }

    /** Die Kotlin-Dateien unter src/main aller Module, ohne die aus den Design-Tokens erzeugten. */
    private fun produktivDateien(): List<java.io.File> = Quellen.module.flatMap { m ->
        java.io.File(m, "src/main").walkTopDown().filter { it.isFile && it.extension == "kt" }.toList()
    }.filterNot { "ERZEUGT aus shared/design-tokens.json" in it.readText() }

    private fun istKommentar(t: String) = t.startsWith("//") || t.startsWith("*") || t.startsWith("/*")

    /** Prosazeilen je Kommentarblock (//-Folge gleicher Einrückung oder /* … */), ohne KDoc-Tags. */
    private fun bloecke(zeilen: List<String>): List<Pair<Int, Int>> {
        val ergebnis = mutableListOf<Pair<Int, Int>>()
        var i = 0
        while (i < zeilen.size) {
            val t = zeilen[i].trim()
            val einzug = zeilen[i].length - zeilen[i].trimStart().length
            var j = i
            val text = mutableListOf<String>()
            when {
                t.startsWith("//") -> {
                    while (j + 1 < zeilen.size && zeilen[j + 1].trim().startsWith("//") &&
                        zeilen[j + 1].length - zeilen[j + 1].trimStart().length == einzug) j++
                    (i..j).mapTo(text) { zeilen[it].trim().removePrefix("//").trim() }
                }
                t.startsWith("/*") && !t.contains("*/") -> {
                    while (j + 1 < zeilen.size && !zeilen[j].contains("*/")) j++
                    (i..j).mapTo(text) { zeilen[it].trim().removePrefix("/**").removePrefix("/*").removeSuffix("*/").removePrefix("*").trim() }
                }
                else -> { i++; continue }
            }
            var imTag = false
            val prosa = text.count { z ->
                if (z.startsWith("@")) imTag = true else if (z.isEmpty()) imTag = false
                z.isNotEmpty() && !imTag
            }
            ergebnis += (i + 1) to prosa
            i = j + 1
        }
        return ergebnis
    }

    @Test
    fun `der Kommentaranteil sinkt, nie steigt`() {
        // CLAUDE.md: zwei bis fünf Zeilen Warum, die Geschichte in den Commit.
        // Gemessen am 05.11.2026: 24,1 %; nach dem Auslagern der langen Kommentare
        // nach docs/begruendungen/ 22,7 % (ohne die erzeugten Token-Dateien).
        val SCHRANKE = 22.7
        var zeilen = 0
        var kommentar = 0
        for (f in produktivDateien()) for (z in f.readLines()) {
            val t = z.trim()
            if (t.isEmpty()) continue
            zeilen++
            if (istKommentar(t)) kommentar++
        }
        assert(zeilen > 30_000) { "Nur $zeilen Zeilen gefunden — greift die Suche noch?" }
        val anteil = Math.round(1000.0 * kommentar / zeilen) / 10.0
        assert(anteil <= SCHRANKE) { "Kommentaranteil $anteil %, erlaubt $SCHRANKE %" }
    }

    @Test
    fun `kein Kommentar hat mehr als fuenf Zeilen Prosa`() {
        // Gemessen am 05.11.2026: 111 Blöcke, ausgelagert nach docs/begruendungen/; seitdem 0.
        var gezaehlt = 0
        val lang = produktivDateien().flatMap { f ->
            bloecke(f.readLines()).also { gezaehlt += it.size }
                .filter { it.second > 5 }.map { "${f.name}:${it.first} (${it.second} Zeilen)" }
        }
        assert(gezaehlt > 1000) { "Nur $gezaehlt Kommentarblöcke gefunden — greift die Suche noch?" }
        assert(lang.isEmpty()) { "Kommentare über fünf Zeilen; das Warum kürzen, die Geschichte in den Commit:\n  " + lang.joinToString("\n  ") }
    }

    @Test
    fun `jeder Verweis auf docs-begruendungen trifft Datei und Anker`() {
        val verweis = Regex("""docs/begruendungen/(\S+?\.md)#([\w-]+)""")
        var n = 0
        val kaputt = produktivDateien().flatMap { f ->
            verweis.findAll(f.readText()).mapNotNull { m ->
                n++
                val doc = java.io.File(Quellen.projekt, "docs/begruendungen/" + m.groupValues[1])
                when {
                    !doc.isFile -> "${f.name}: ${m.groupValues[1]} fehlt"
                    "<a id=\"${m.groupValues[2]}\"></a>" !in doc.readText() -> "${f.name}: ${m.value}"
                    else -> null
                }
            }.toList()
        }
        assert(n >= 100) { "Nur $n Verweise gefunden — greift die Suche noch?" }
        assert(kaputt.isEmpty()) { "Verweise ins Leere:\n  " + kaputt.joinToString("\n  ") }
    }

    @Test
    fun `ein Import allein fuehrt nichts aus, ein Aufruf schon`() {
        val nurImport = "import ch.brickinventoryapp.ui.CatalogYearMath\nval s = Quellen.lies(\"ui/CatalogYearMath.kt\")"
        val aufruf = nurImport + "\nval n = CatalogYearMath.nummerAus(0.5f, 100)"
        org.junit.Assert.assertFalse("Ein Import ist kein Aufruf", fuehrtAus(nurImport))
        org.junit.Assert.assertTrue("Ein Aufruf einer App-Funktion führt aus", fuehrtAus(aufruf))
        org.junit.Assert.assertTrue(fuehrtAus("fun x() = runTest { }"))
    }
}
