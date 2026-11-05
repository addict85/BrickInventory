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
 * 53 seit TokenTresorTest den echten PreferencesManager ausführt (sec17 A-N4); mit 52
 * gemessen rot (05.11.2026, kotlinc lokal).
 *
 * Kommentare (05.11.2026, gemessen mit kotlinc lokal):
 *   kommentar-zu-lang    sechs Zeilen Prosa über AppViewModel → rot „kein Kommentar hat …“
 *   verweis-ins-leere    ein Anker in Vorwaermen.kt verschrieben → rot „jeder Verweis …“
 * detekt-Baseline (05.11.2026, gemessen mit kotlinc lokal):
 *   detekt-baseline-waechst       Obergrenze eins unter den Einträgen → rot „die detekt-Baseline …“
 *   detekt-baseline-fremde-regel  ein MagicNumber-Eintrag → rot, derselbe Test
 * Abbruch (05.11.2026): cache-schluckt-abbruch macht auch „kein breiter Fang …“ rot.
 * Namen (05.11.2026, gemessen mit kotlinc lokal): voll-qualifiziert schreibt in
 *   Vorwaermen.kt `ch.brickinventoryapp.util.fangeAusserAbbruch` aus → rot „kein voll …“
 * Warten (05.11.2026, gemessen mit kotlinc lokal): warten-in-echtzeit schläft in
 *   TeileViewModelTest wieder 200 ms → rot „Echtzeit-Warten in Tests …“
 * Fläche (05.11.2026, gemessen mit kotlinc lokal): core-data-oeffentlich nimmt liegtUnter
 *   das internal → rot „die oeffentliche Flaeche von core-data …“
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
        val SCHRANKE = 53
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
            ergebnis += (i + 1) to prosa(text)
            i = j + 1
        }
        return ergebnis
    }

    /** Prosazeilen ohne KDoc-Tags; ein Tag gilt bis zur nächsten Leerzeile. */
    private fun prosa(text: List<String>): Int {
        var imTag = false
        return text.count { z ->
            if (z.startsWith("@")) imTag = true else if (z.isEmpty()) imTag = false
            z.isNotEmpty() && !imTag
        }
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
    fun `eine Kurzfassung endet mit einem ganzen Satz, und keine KDoc haengt an nichts`() {
        // Die maschinell gewählten Kurzfassungen brachen mitten im Satz ab, und
        // verschobene Blöcke standen als zweite KDoc vor fremden Deklarationen.
        val satzende = Regex("""[.:!?)“"»\]═]$""")
        var verweise = 0
        val funde = produktivDateien().flatMap { f ->
            val z = f.readLines()
            z.indices.mapNotNull { i ->
                val vor = if (i > 0) z[i - 1].trim().trimStart('/', '*').trim() else ""
                when {
                    "Ausführlich: docs/begruendungen/" in z[i] -> {
                        verweise++
                        if (vor.isNotEmpty() && !satzende.containsMatchIn(vor)) "${f.name}:$i bricht ab: $vor" else null
                    }
                    z[i].trim().startsWith("/**") && i > 0 && z[i - 1].trim().endsWith("*/") -> "${f.name}:${i + 1} zweite KDoc"
                    else -> null
                }
            }
        }
        assert(verweise >= 100) { "Nur $verweise Verweise gefunden — greift die Suche noch?" }
        assert(funde.isEmpty()) { "Kurzfassungen zu einem Warum umschreiben:\n  " + funde.joinToString("\n  ") }
    }

    /** Index der öffnenden Klammer zur schliessenden bei [zu], -1 wenn keine. */
    private fun oeffnendeKlammer(c: String, zu: Int): Int {
        var tiefe = 0
        for (i in zu downTo 0) {
            if (c[i] == '}') tiefe++
            if (c[i] == '{' && --tiefe == 0) return i
        }
        return -1
    }

    private val breiterFang = Regex("""\}\s*catch\s*\(\s*\w+\s*:\s*(?:Exception|Throwable)\s*\)""")
    private val fangKlausel = Regex("""\}\s*catch\s*\(\s*\w+\s*:\s*([\w.]+)\s*\)$""")

    /** true, wenn der Fang keinen Abbruch-Zweig hat und sein try-Rumpf [aufruf] enthält; null ohne try. */
    private fun schlucktAbbruch(c: String, fang: MatchResult, aufruf: Regex): Boolean? {
        var zu = fang.range.first
        var abbruch = false
        var auf = oeffnendeKlammer(c, zu)
        var klausel = if (auf < 0) null else fangKlausel.find(c.substring(maxOf(0, auf - 200), auf).trimEnd())
        while (auf >= 0 && klausel != null) {
            if (klausel.groupValues[1].endsWith("CancellationException")) abbruch = true
            zu = c.lastIndexOf('}', auf - 1)
            auf = oeffnendeKlammer(c, zu)
            klausel = if (auf < 0) null else fangKlausel.find(c.substring(maxOf(0, auf - 200), auf).trimEnd())
        }
        if (auf < 0 || !c.substring(0, auf).trimEnd().endsWith("try")) return null
        return !abbruch && aufruf.containsMatchIn(c.substring(auf + 1, zu))
    }

    @Test
    fun `kein breiter Fang verschluckt das Abbrechen eines suspendierenden Aufrufs`() {
        // Ein `catch (_: Exception)` um einen suspendierenden Aufruf fängt auch die
        // CancellationException; der abgebrochene Aufrufer liefe weiter. Dafür gibt
        // es fangeAusserAbbruch oder einen vorangestellten Abbruch-Zweig.
        val texte = produktivDateien().associateWith { code(it.readText()) }
        val namen = texte.values.flatMap { c ->
            Regex("""\bsuspend\s+fun\s+(?:<[^>]*>\s*)?(?:\w+\.)?(\w+)""").findAll(c).map { it.groupValues[1] }.toList()
        }.toSet() + setOf("collect", "withContext", "withLock", "delay", "await", "join", "emit")
        val aufruf = Regex("""\b(?:${namen.joinToString("|")})\s*[({]""")
        var geprueft = 0
        val funde = texte.flatMap { (f, c) ->
            breiterFang.findAll(c).mapNotNull { m ->
                val schluckt = schlucktAbbruch(c, m, aufruf) ?: return@mapNotNull null
                geprueft++
                if (schluckt) "${f.name}:${c.substring(0, m.range.first).count { it == '\n' } + 1}" else null
            }.toList()
        }
        assert(namen.size > 100 && geprueft >= 20) { "Nur ${namen.size} suspend-Funktionen, $geprueft Fänge — greift die Suche noch?" }
        assert(funde.isEmpty()) {
            "Breiter Fang um einen suspendierenden Aufruf ohne Abbruch-Zweig; fangeAusserAbbruch verwenden:\n  " +
                funde.joinToString("\n  ")
        }
    }

    @Test
    fun `die detekt-Baseline haelt nur Laenge und Verzweigung und schrumpft`() {
        val baseline = java.io.File(Quellen.projekt, "config/detekt/baseline.xml").readText()
        val ids = Regex("""<ID>(\w+):""").findAll(baseline).map { it.groupValues[1] }.toList()
        val grenze = java.io.File(Quellen.projekt, "tools/detekt-obergrenze.txt").readLines()
            .first { it.isNotBlank() && !it.startsWith("#") }.trim().toInt()
        assert(ids.size >= 10) { "Nur ${ids.size} Einträge in der Baseline — Muster veraltet?" }
        val fremd = ids.filter { it !in setOf("LongMethod", "CyclomaticComplexMethod") }.distinct()
        assert(fremd.isEmpty()) { "Die Baseline verschweigt andere Regeln: $fremd. Den Fund beheben, nicht eintragen." }
        assert(ids.size <= grenze) {
            "${ids.size} Funktionen in der detekt-Baseline, erlaubt sind $grenze. Eine neue lange " +
                "oder verzweigte Funktion zerlegen, statt sie einzutragen."
        }
        if (ids.size < grenze) println("  detekt-Baseline: ${ids.size} (Obergrenze $grenze) — tools/detekt-obergrenze.txt nachziehen")
    }

    @Test
    fun `Echtzeit-Warten in Tests wird weniger, nie mehr`() {
        // Ein Test, der schläft, ist langsam und auf einem vollen Runner brüchig. ViewModel-Tests
        // laufen im Takt (PfadServer.imTakt, Test-Dispatcher); gezählt wird, was noch wartet.
        val SCHLAFEN = 17
        val WARTEN = 83
        val dateien = (Quellen.tests.walkTopDown() + java.io.File(Quellen.projekt, "core-testing/src/main").walkTopDown())
            .filter { it.isFile && it.extension == "kt" }.toList()
        val texte = dateien.map { code(it.readText()) }
        val schlafen = texte.sumOf { Regex("""\bThread\.sleep\(""").findAll(it).count() }
        val warten = texte.sumOf { Regex("""\bwarteBis\(""").findAll(it).count() }
        assert(dateien.size > 200) { "Nur ${dateien.size} Testdateien gefunden — greift die Suche noch?" }
        assert(schlafen <= SCHLAFEN && warten <= WARTEN) {
            "Thread.sleep $schlafen (erlaubt $SCHLAFEN), warteBis $warten (erlaubt $WARTEN). Neue Tests laufen " +
                "im Takt: PfadServer.imTakt() oder FakeApi mit Test-Dispatcher, Compose mit waitUntil."
        }
        if (schlafen < SCHLAFEN || warten < WARTEN) println("  Echtzeit-Warten: $schlafen / $warten — Schranken nachziehen")
    }

    @Test
    fun `die oeffentliche Flaeche von core-data waechst nicht`() {
        // Was nur core-data selbst braucht, ist internal: Jede öffentliche Deklaration ist
        // Schnittstelle für alle Bereiche. Gezählt wird auf oberster Ebene.
        val GRENZE = 236
        val dekl = Regex("""^(?:@[\w.:]+(?:\([^)\n]*\))?\s+)*((?:(?:public|internal|private|protected|data|sealed|abstract|open|enum|inline|value|annotation|const|suspend|operator|infix|tailrec|lateinit|fun interface)\s+)*)(?:fun\s+interface|class|interface|object|typealias|fun|val|var)\s""", RegexOption.MULTILINE)
        val dateien = java.io.File(Quellen.projekt, "core-data/src/main").walkTopDown().filter { it.isFile && it.extension == "kt" }.toList()
        assert(dateien.size > 100) { "Nur ${dateien.size} Dateien in core-data — greift die Suche noch?" }
        val oeffentlich = dateien.sumOf { f ->
            dekl.findAll(f.readText()).count { "private" !in it.groupValues[1] && "internal" !in it.groupValues[1] }
        }
        assert(oeffentlich <= GRENZE) {
            "$oeffentlich öffentliche Deklarationen in core-data, erlaubt sind $GRENZE. Was nur das Modul braucht, wird internal."
        }
        if (oeffentlich < GRENZE) println("  core-data öffentlich: $oeffentlich (Grenze $GRENZE) — nachziehen")
    }

    @Test
    fun `kein voll qualifizierter Projektname im Code`() {
        // Ein Import zeigt die Abhängigkeit im Kopf der Datei; inline bleibt sie
        // unsichtbar und die Zeile lang. Kommentare und Zeichenketten zählen nicht.
        val voll = Regex("""(?<![\w.])ch\.brickinventoryapp(?:\.[a-z]\w*)+\.[A-Za-z_]\w*""")
        val dateien = produktivDateien() + Quellen.tests.walkTopDown().filter { it.isFile && it.extension == "kt" }
        assert(dateien.size > 500) { "Nur ${dateien.size} Dateien gefunden — greift die Suche noch?" }
        val funde = dateien.flatMap { f ->
            code(f.readText()).lines().map { it.replace(Regex("//.*"), "") }
                .filterNot { it.trimStart().startsWith("import ") || it.trimStart().startsWith("package ") }
                .filter { voll.containsMatchIn(it) }.map { "${f.name}: ${it.trim()}" }
        }
        assert(funde.isEmpty()) { "Voll qualifizierte Namen; importieren statt ausschreiben:\n  " + funde.joinToString("\n  ") }
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
