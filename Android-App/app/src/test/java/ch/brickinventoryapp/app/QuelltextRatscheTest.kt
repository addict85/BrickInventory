package ch.brickinventoryapp.app

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File
import ch.brickinventoryapp.testing.Quellen

/**
 * Ratschen: Zahlen, die nur sinken dürfen. Jede steht genau auf dem gemessenen Wert;
 * steigt sie, ist der Test rot, sinkt sie, verlangt er, die Schranke nachzuziehen.
 * Eine Regex auf den Quelltext bestätigt nur, dass eine Zeile dasteht; gezählt wird,
 * wie viele Testfunktionen das noch tun. Gegenstück zu Web-App/test/ratschen.test.js.
 *
 * Gegenproben (Patches unter gegenproben/):
 *   schranke-zu-hoch           Schranke der Quelltext-Funktionen +1 → rot „Testfunktionen,
 *                              die Quelltext lesen …“ (gesunken, nachziehen)
 *   helfer-zaehlt-nicht        ein lesender Helfer zählt nicht mehr → rot, derselbe Test
 *   werkzeugausgabe-zaehlt     die Ausgabe eines Werkzeugs zählt wieder als Quelltext → rot „die Ausgabe
 *                              eines Werkzeugs …“ und „Testfunktionen, die Quelltext lesen …“
 *   geschichte-im-testkopf     Nachtragsnummer und Melder im Kopf von TabOpensAtTopTest → rot „lange
 *                              Kommentare im Workflow und in Tests …“
 *   kuerzel-im-bau             ein Prüfkürzel wieder im Kommentar von settings.gradle.kts → rot, derselbe Test
 *   kommentar-zu-lang          sechs Zeilen Prosa über AppViewModel → rot „kein Kommentar hat …“
 *   bau-kommentar-zu-lang      sechs Zeilen in gradle.properties → rot „kein Kommentar in Build …“
 *   verweis-aufs-archiv        ein „Ausführlich: docs/begruendungen/…“ in TokenTresor.kt → rot „kein Verweis
 *                              auf das Begründungsarchiv …“
 *   kdoc-doppelt               ein verwaister KDoc-Block vor Alarmabholung → rot, derselbe Test
 *   detekt-baseline-waechst    Obergrenze eins unter den Einträgen → rot „die detekt-Baseline …“
 *   detekt-baseline-fremde-regel  ein MagicNumber-Eintrag → rot, derselbe Test
 *   start-schluckt-abbruch     macht „kein breiter Fang …“ rot
 *   runcatching-um-suspend     BrickInventoryApp übernimmt das alte Token wieder in runCatching
 *                              → rot „kein runCatching verschluckt …“
 *   runcatching-um-suspend-lambda  Offlineablage ruft die suspend-Quelle (ein Feld vom Typ
 *                              `suspend () -> String?`) in runCatching auf → rot, derselbe Test
 *   voll-qualifiziert          `ch.brickinventoryapp.model.util.fangeAusserAbbruch` ausgeschrieben → rot
 *                              „kein voll qualifizierter Projektname …“ und „voll qualifizierte Namen …“
 *   warten-in-echtzeit         PartsViewModelTest schläft wieder 200 ms → rot „Echtzeit-Warten …“
 *   core-data-oeffentlich      liesBelow ohne internal → rot „die oeffentliche Flaeche der Datenmodule …“
 *   bereich-oeffentlich        qrSwitchesServer ohne internal → rot „die oeffentliche Flaeche der Bereiche …“
 *   erfassung-an-der-activity  EntryViewModel wieder per `by viewModels()` in MainActivity
 *                              → rot „die Activity haelt nicht mehr ViewModels …“
 *   padding-feste-zahl         DetailRow2 wieder `padding(vertical = 5.dp)` → rot „feste Zahlen in padding …“
 *   abstand-zwischen-feste-zahl  Lagerorte wieder `Spacer(Modifier.width(8.dp))` → rot, derselbe Test
 *   dialog-ohne-fenstername    UpdateDialog ohne paneTitle → rot „kein AlertDialog ohne Fenstername …“
 *   dialog-graue-flaeche       UpdateDialog ohne fensterFlaeche() → rot „jeder AlertDialog liegt auf der Fensterflaeche“
 *   gutschein-eigene-knopfreihe  Gutschein-Formular wieder mit eigener Reihe Speichern | Abbrechen
 *                              → rot „Abbrechen und Hauptknopf stehen nur in der Knopfzeile …“
 *   string-format-ohne-locale  MonitoringScreen wieder `String.format(fmt, sn)` → rot „kein String-format …“
 *   laden-im-bildschirm        SetDetailScreen lädt wieder per LaunchedEffect(setNumber)
 *                              → rot „Bildschirme stossen das Laden nicht …“
 *   merkliste-laedt-wieder     WantedUiState wieder mit einem Feld `nochLaedt: Boolean` → rot
 *                              „Bildschirme stossen das Laden nicht …, Zustaende tragen Laden …“
 *   merkliste-fehler-als-text  WantedUiState mit `errorText: String?` → rot, derselbe Test
 *   konto-speichert-wieder     AccountUiState wieder mit `speichert: Boolean` → rot, derselbe Test
 *   galerie-fehler-als-text    GalleryUiState mit `galleryFehlerSatz: String?` → rot, derselbe Test
 *   fachtyp-preis-als-double   `val betragAlt: Double?` in PurchaseSumsView → rot „Beträge als Double …“
 *   fachtyp-datum-als-text     `val geaendertAm: String?` in KaufAnsicht → rot „Daten als String …“
 */
class QuelltextRatscheTest {

    private val string = Regex("\"\"\"[\\s\\S]*?\"\"\"|\"(?:\\\\.|[^\"\\\\\n])*\"")

    /** Ohne Kommentare und Zeichenketten: Ein Dateiname wie "GalleryScreen.kt" ist kein Aufruf. */
    private fun code(roh: String) = string.replace(Quellen.withoutComments(roh), "\"\"")

    /** Gleichheit: Steigt die Zahl, ist das ein Fehler; sinkt sie, wird die Schranke nachgezogen. */
    private fun ratchet(was: String, limit: Number, gemessen: Number, hinweis: String = "") {
        assertTrue("$was: $gemessen, erlaubt $limit. $hinweis", gemessen.toDouble() <= limit.toDouble())
        assertEquals("$was ist auf $gemessen gesunken — die Schranke von $limit auf $gemessen senken",
            limit.toDouble(), gemessen.toDouble(), 0.0)
    }

    /**
     * Was als Lesen von Quelltext zählt: Quellen.*, Pfade unter src/main, Workflow, Ressourcen,
     * Dateitext. Die Ausgabe eines gestarteten Werkzeugs (`bufferedReader().readText()`) ist
     * ein Ergebnis, kein Quelltext.
     */
    private val readsSource = Regex("""Quellen\.|"src/main/|File\("src/main|\.\./\.\./\.github|res/values|(?<!bufferedReader\(\)\.)readText\(\)|readLines\(\)""")

    /**
     * (Testfunktionen, davon lesend) einer Datei. Eine Funktion liest Quelltext, wenn ihr Rumpf
     * es tut oder einen Wert bzw. eine Funktion der Datei benutzt, die es tut.
     */
    internal fun sourceTextFunctions(roh: String): Pair<Int, Int> {
        val c = Quellen.withoutComments(roh)
        val helper = Regex("""(?:val|fun)\s+(\w+)[^\n]*""").findAll(c).filter { m ->
            val stueck = c.substring(m.range.first, minOf(c.length, m.range.first + 400)).substringBefore("\n\n")
            readsSource.containsMatchIn(m.value) || (m.value.startsWith("fun") && readsSource.containsMatchIn(stueck))
        }.map { it.groupValues[1] }.toSet()
        val tests = c.split(Regex("""@Test\b""")).drop(1).map { it.substringBefore("\n    }\n") }
        val lesend = tests.count { t -> readsSource.containsMatchIn(t) || helper.any { Regex("""\b${Regex.escape(it)}\b""").containsMatchIn(t) } }
        return tests.size to lesend
    }

    @Test
    fun `Testfunktionen, die Quelltext lesen, werden weniger, nie mehr`() {
        val FUNCTIONS = 211
        val ONLY_SOURCE_TEXT = 33
        val alle = Quellen.tests.walkTopDown().filter { it.isFile && it.name.endsWith("Test.kt") }
            .filter { it.name != "QuelltextRatscheTest.kt" }.toList()
        val zaehlung = alle.associate { it.name to sourceTextFunctions(it.readText()) }
        val gesamt = zaehlung.values.sumOf { it.first }
        assertTrue("Nur ${alle.size} Testdateien, $gesamt Tests — greift die Suche noch?", alle.size >= 200 && gesamt >= 1000)
        val nur = zaehlung.filterValues { (n, l) -> n > 0 && l == n }.keys.sorted()
        ratchet("Testfunktionen, die Quelltext lesen", FUNCTIONS, zaehlung.values.sumOf { it.second },
            "Prüft der neue Test Verhalten, soll er den Code ausführen statt nachzusehen, ob eine Zeile dasteht.")
        ratchet("Testdateien, die nur Quelltext lesen", ONLY_SOURCE_TEXT, nur.size, nur.joinToString())
    }

    @Test
    fun `ein lesender Helfer zaehlt fuer jede Funktion, die ihn benutzt`() {
        val datei = "private val src = Quellen.lies(\"x.kt\")\n" +
            "@Test\nfun a() {\n    assert(\"y\" in src)\n    }\n" +
            "@Test\nfun b() {\n    assert(1 + 1 == 2)\n    }\n"
        assertEquals(2 to 1, sourceTextFunctions(datei))
    }

    @Test
    fun `die Ausgabe eines Werkzeugs ist kein Quelltext`() {
        val datei = "private fun lauf() = ProcessBuilder(\"python3\").start().inputStream.bufferedReader().readText()\n" +
            "@Test\nfun a() {\n    assert(\"ok\" in lauf())\n    }\n\n" +
            "@Test\nfun b() {\n    assert(\"x\" in File(\"y\").readText())\n    }\n"
        assertEquals(2 to 1, sourceTextFunctions(datei))
    }

    /** Die Kotlin-Dateien unter src/main aller Module, ohne die aus den Design-Tokens erzeugten. */
    private fun productionFiles(): List<File> = Quellen.module.flatMap { m ->
        File(m, "src/main").walkTopDown().filter { it.isFile && it.extension == "kt" }.toList()
    }.filterNot { "GENERATED from shared/design-tokens.json" in it.readText() }

    private fun isComment(t: String) = t.startsWith("//") || t.startsWith("*") || t.startsWith("/*")

    /** Prosazeilen je Kommentarblock (//-Folge gleicher Einrückung oder /* … */), ohne KDoc-Tags. */
    private fun blocks(zeilen: List<String>): List<Pair<Int, Int>> {
        val ergebnis = mutableListOf<Pair<Int, Int>>()
        var i = 0
        while (i < zeilen.size) {
            val t = zeilen[i].trim()
            val indent = zeilen[i].length - zeilen[i].trimStart().length
            var j = i
            val text = mutableListOf<String>()
            when {
                t.startsWith("//") -> {
                    while (j + 1 < zeilen.size && zeilen[j + 1].trim().startsWith("//") &&
                        zeilen[j + 1].length - zeilen[j + 1].trimStart().length == indent) j++
                    (i..j).mapTo(text) { zeilen[it].trim().removePrefix("//").trim() }
                }
                t.startsWith("/*") && !t.contains("*/") -> {
                    while (j + 1 < zeilen.size && !zeilen[j].contains("*/")) j++
                    (i..j).mapTo(text) { zeilen[it].trim().removePrefix("/**").removePrefix("/*").removeSuffix("*/").removePrefix("*").trim() }
                }
                else -> { i++; continue }
            }
            ergebnis += (i + 1) to prose(text)
            i = j + 1
        }
        return ergebnis
    }

    /** Prosazeilen ohne KDoc-Tags; ein Tag gilt bis zur nächsten Leerzeile. */
    private fun prose(text: List<String>): Int {
        var inTag = false
        return text.count { z ->
            if (z.startsWith("@")) inTag = true else if (z.isEmpty()) inTag = false
            z.isNotEmpty() && !inTag
        }
    }

    @Test
    fun `der Kommentaranteil sinkt, nie steigt`() {
        // Ein Anteil, keine Zahl: Er darf sinken, ohne dass jemand nachziehen muss.
        val SCHRANKE = 22.7
        var zeilen = 0
        var comment = 0
        for (f in productionFiles()) for (z in f.readLines()) {
            val t = z.trim()
            if (t.isEmpty()) continue
            zeilen++
            if (isComment(t)) comment++
        }
        assert(zeilen > 30_000) { "Nur $zeilen Zeilen gefunden — greift die Suche noch?" }
        val share = Math.round(1000.0 * comment / zeilen) / 10.0
        assert(share <= SCHRANKE) { "Kommentaranteil $share %, erlaubt $SCHRANKE %" }
    }

    @Test
    fun `kein Kommentar hat mehr als fuenf Zeilen Prosa`() {
        var gezaehlt = 0
        val lang = productionFiles().flatMap { f ->
            blocks(f.readLines()).also { gezaehlt += it.size }
                .filter { it.second > 5 }.map { "${f.name}:${it.first} (${it.second} Zeilen)" }
        }
        assert(gezaehlt > 1000) { "Nur $gezaehlt Kommentarblöcke gefunden — greift die Suche noch?" }
        assert(lang.isEmpty()) { "Kommentare über fünf Zeilen; das Warum kürzen, die Geschichte in den Commit:\n  " + lang.joinToString("\n  ") }
    }

    /** Prosazeilen je `#`-Block (gleiche Einrückung); leere `#`-Zeilen zählen nicht. */
    private fun hashesBlocks(zeilen: List<String>): List<Pair<Int, Int>> {
        val ergebnis = mutableListOf<Pair<Int, Int>>()
        var i = 0
        while (i < zeilen.size) {
            val indent = zeilen[i].length - zeilen[i].trimStart().length
            if (!zeilen[i].trimStart().startsWith("#")) { i++; continue }
            var j = i
            while (j + 1 < zeilen.size && zeilen[j + 1].trimStart().startsWith("#") &&
                zeilen[j + 1].length - zeilen[j + 1].trimStart().length == indent) j++
            ergebnis += (i + 1) to (i..j).count { zeilen[it].trim().trimStart('#').isNotBlank() }
            i = j + 1
        }
        return ergebnis
    }

    /** Buildskripte aller Module, build-logic, Katalog und gradle.properties. */
    private fun baudateien(): List<File> =
        Quellen.module.map { File(it, "build.gradle.kts") }.filter { it.isFile } +
            listOf("build.gradle.kts", "settings.gradle.kts", "gradle/libs.versions.toml", "gradle.properties")
                .map { File(Quellen.project, it) }.filter { it.isFile } +
            File(Quellen.project, "build-logic").walkTopDown()
                .filter { it.isFile && (it.extension == "kt" || it.name.endsWith(".gradle.kts")) && "/build/" !in it.invariantSeparatorsPath }

    @Test
    fun `kein Kommentar in Build-Dateien hat mehr als fuenf Zeilen Prosa`() {
        var gezaehlt = 0
        val lang = baudateien().flatMap { f ->
            val z = f.readLines()
            val blocks = if (f.extension in setOf("toml", "properties")) hashesBlocks(z) else blocks(z)
            blocks.also { gezaehlt += it.size }.filter { it.second > 5 }.map { "${f.name}:${it.first} (${it.second} Zeilen)" }
        }
        assertTrue("Nur $gezaehlt Kommentarblöcke in Build-Dateien — greift die Suche noch?", gezaehlt > 30)
        assertTrue("Kommentare über fünf Zeilen; das Warum kürzen, die Geschichte in den Commit:\n  " + lang.joinToString("\n  "),
            lang.isEmpty())
    }

    @Test
    fun `lange Kommentare im Workflow und in Tests werden weniger`() {
        val WORKFLOW = 1
        val TESTS = 50
        val DATE_AND_ID = 0
        val HISTORY = 0
        val wf = File(Quellen.project, "../.github/workflows/android.yml").readLines()
        val wfLang = hashesBlocks(wf).filter { it.second > 5 }
        // In Tests darf ein Absatz nur dann länger sein, wenn er die Gegenproben aufzählt.
        val dateien = Quellen.tests.walkTopDown().filter { it.isFile && it.extension == "kt" }.toList()
        val testLang = dateien.flatMap { f -> longParagraphs(f.readLines()).map { "${f.name}:$it" } }
        val kennung = Regex("""[0-9]{2}\.[0-9]{2}\.20[0-9]{2}|\b(?:arch|sec|ux|perf)[0-9]+\b|\bhardened-[0-9]+""")
        val history = dateien.flatMap { f ->
            f.readLines().filter { z ->
                val t = z.trim()
                (t.startsWith("//") || t.startsWith("*") || t.startsWith("/*")) &&
                    kennung.containsMatchIn(t) && !t.contains("Gegenprobe", ignoreCase = true)
            }.map { "${f.name}: ${it.trim()}" }
        }
        // Wer was gemeldet hat und in welchem Nachtrag, steht im Commit, nicht im Testkopf.
        val narrative = Regex("""Nachtr[aä]g\w*\s+[0-9]|\bMarcos?\b|Woher dies|\bLauf [0-9]{2,}|CI-Lauf|\bRunde [0-9]+""")
        val tells = dateien.flatMap { f ->
            f.readLines().filter { z ->
                val t = z.trim()
                (t.startsWith("//") || t.startsWith("*") || t.startsWith("/*")) && narrative.containsMatchIn(t)
            }.map { "${f.name}: ${it.trim()}" }
        }
        assertTrue("Nur ${wf.size} Zeilen Workflow — Pfad veraltet?", wf.size > 500)
        ratchet("Workflow-Kommentare über fünf Zeilen", WORKFLOW, wfLang.size, wfLang.joinToString())
        ratchet("Absätze über fünf Zeilen in Tests ohne Gegenproben", TESTS, testLang.size, testLang.take(20).joinToString())
        ratchet("Datum oder Prüfkennung in Testkommentaren ausserhalb der Gegenproben", DATE_AND_ID, history.size,
            history.take(20).joinToString("\n  "))
        ratchet("Geschichte (Nachtrag, Melder, Herkunft) in Testkommentaren", HISTORY, tells.size,
            tells.take(20).joinToString("\n  "))
        // Im Code und in Build-Dateien nennt ein Kommentar das Warum, nicht die Prüfung, die es fand.
        val abbreviation = Regex("""\((?:sec|arch|ux|perf)[0-9]+[^)]*\)|\((?:[HMN][0-9]{1,2})\)|\bNachtrag [0-9]+""")
        val gekuerzt = (productionFiles() + baudateien()).flatMap { f ->
            f.readLines().filter { z -> z.trim().let { isComment(it) || it.startsWith("#") } && abbreviation.containsMatchIn(z) }
                .map { "${f.name}: ${it.trim()}" }
        }
        ratchet("Prüfungskürzel in Kommentaren von Code und Bau", 0, gekuerzt.size, gekuerzt.take(20).joinToString("\n  "))
    }

    /** Zeilennummern der Kommentar-Absätze über fünf Prosazeilen, die nicht mit „Gegenprobe“ beginnen. */
    private fun longParagraphs(zeilen: List<String>): List<Int> {
        val findings = mutableListOf<Int>()
        var anfang = -1
        val paragraph = mutableListOf<String>()
        fun schliessen() {
            if (paragraph.size > 5 && !paragraph.first().startsWith("Gegenprobe")) findings += anfang + 1
            paragraph.clear()
        }
        for ((i, z) in zeilen.withIndex()) {
            val t = z.trim()
            val comment = t.startsWith("//") || t.startsWith("*") || t.startsWith("/*")
            val text = t.removePrefix("/**").removePrefix("/*").removePrefix("//").removeSuffix("*/").removePrefix("*").trim()
            if (!comment || text.isEmpty() || text.startsWith("@")) { schliessen(); continue }
            if (paragraph.isEmpty()) anfang = i
            paragraph += text
        }
        schliessen()
        return findings
    }

    @Test
    fun `kein Verweis auf das Begruendungsarchiv, und keine KDoc haengt an nichts`() {
        // Das Archiv docs/begruendungen ist nicht mehr im Baum; das Warum steht im Kommentar,
        // die Geschichte im Commit. Ein zweiter KDoc-Block direkt davor hängt an nichts.
        var kdocs = 0
        val findings = productionFiles().flatMap { f ->
            val z = f.readLines()
            z.indices.mapNotNull { i ->
                if (z[i].trim().startsWith("/**")) kdocs++
                when {
                    "docs/begruendungen/" in z[i] -> "${f.name}:${i + 1} verweist auf das Archiv"
                    z[i].trim().startsWith("/**") && i > 0 && z[i - 1].trim().endsWith("*/") -> "${f.name}:${i + 1} zweite KDoc"
                    else -> null
                }
            }
        }
        assert(kdocs >= 500) { "Nur $kdocs KDoc-Blöcke gefunden — greift die Suche noch?" }
        assert(findings.isEmpty()) { "Das Warum in den Kommentar, die Geschichte in den Commit:\n  " + findings.joinToString("\n  ") }
    }

    /** Index der öffnenden Klammer zur schliessenden bei [zu], -1 wenn keine. */
    private fun openingBracket(c: String, zu: Int): Int {
        var tiefe = 0
        for (i in zu downTo 0) {
            if (c[i] == '}') tiefe++
            if (c[i] == '{' && --tiefe == 0) return i
        }
        return -1
    }

    private val widerCatch = Regex("""\}\s*catch\s*\(\s*\w+\s*:\s*(?:Exception|Throwable)\s*\)""")
    private val catchClause = Regex("""\}\s*catch\s*\(\s*\w+\s*:\s*([\w.]+)\s*\)$""")

    /** true, wenn der Fang keinen Abbruch-Zweig hat und sein try-Rumpf [call] enthält; null ohne try. */
    private fun swallowsAbort(c: String, fang: MatchResult, call: Regex): Boolean? {
        var zu = fang.range.first
        var abort = false
        var auf = openingBracket(c, zu)
        var clause = if (auf < 0) null else catchClause.find(c.substring(maxOf(0, auf - 200), auf).trimEnd())
        while (auf >= 0 && clause != null) {
            if (clause.groupValues[1].endsWith("CancellationException")) abort = true
            zu = c.lastIndexOf('}', auf - 1)
            auf = openingBracket(c, zu)
            clause = if (auf < 0) null else catchClause.find(c.substring(maxOf(0, auf - 200), auf).trimEnd())
        }
        if (auf < 0 || !c.substring(0, auf).trimEnd().endsWith("try")) return null
        return !abort && call.containsMatchIn(c.substring(auf + 1, zu))
    }

    /** Die Quelltexte der App und ein Muster für den Aufruf einer ihrer suspend-Funktionen. */
    private val suspendCalls: Pair<Map<File, String>, Pair<Set<String>, Regex>> by lazy {
        val texts = productionFiles().associateWith { code(it.readText()) }
        val namen = texts.values.flatMap { c ->
            Regex("""\bsuspend\s+fun\s+(?:<[^>]*>\s*)?(?:\w+\.)?(\w+)""").findAll(c).map { it.groupValues[1] }.toList()
        }.toSet() + setOf("collect", "withContext", "withLock", "delay", "await", "join", "emit", "first")
        texts to (namen to Regex("""\b(?:${namen.joinToString("|")})\s*[({]"""))
    }

    /** Parameter und Felder mit suspend-Funktionstyp (`quelle: suspend () -> T`); nur in ihrer Datei ein Name. */
    private val suspendType = Regex("""\b(\w+)\s*:\s*\(?\s*suspend\b""")

    /** Das Aufrufmuster für [c]: die suspend-Funktionen der App und die suspend-Lambdas der Datei. */
    private fun callIn(c: String): Regex {
        val (namen, _) = suspendCalls.second
        val alle = namen + suspendType.findAll(c).map { it.groupValues[1] }
        return Regex("""\b(?:${alle.joinToString("|")})\s*[({]""")
    }

    private val koroutinenBlock = Regex("""\b(?:launch|async|runBlocking|withContext\([^()]*\)|coroutineScope|supervisorScope|flow|runTest)\s*(?:\([^()]*\))?\s*$""")

    /** Läuft die Stelle [ab] in einer suspend-Funktion oder einem Koroutinen-Block? Nur dort gibt es einen Abbruch zu verschlucken. */
    private fun inKoroutine(c: String, ab: Int): Boolean {
        val davor = c.substring(maxOf(0, ab - 300), ab)
        val instruction = davor.substring(maxOf(davor.lastIndexOf('{'), davor.lastIndexOf('}')) + 1)
        // Auch `= gueltig(runCatching {`: Der Ausdruck einer suspend fun läuft ganz in ihr.
        if (Regex("""\bsuspend\s+fun\b[^=]*=[^{};]*$""").containsMatchIn(instruction)) return true
        var tiefe = 0
        for (j in ab - 1 downTo 0) {
            when (c[j]) {
                '}' -> tiefe++
                '{' -> if (tiefe > 0) tiefe-- else {
                    val kopf = c.substring(maxOf(0, j - 300), j)
                    if (koroutinenBlock.containsMatchIn(kopf)) return true
                    val fn = kopf.lastIndexOf("fun ")
                    if (fn >= 0 && !kopf.substring(fn).contains('{') && !kopf.substring(fn).contains('}'))
                        return Regex("""\bsuspend\s+(?:\w+\s+)*$""").containsMatchIn(kopf.substring(0, fn))
                }
            }
        }
        return false
    }

    @Test
    fun `kein runCatching verschluckt das Abbrechen eines suspendierenden Aufrufs`() {
        // runCatching fängt auch die CancellationException wie ein breiter catch; der
        // abgebrochene Aufrufer liefe weiter. Dafür gibt es fangeAusserAbbruch.
        val texts = suspendCalls.first
        var geprueft = 0
        val findings = texts.flatMap { (f, c) ->
            val call = callIn(c)
            Regex("""\brunCatching\s*\{""").findAll(c).mapNotNull { m ->
                geprueft++
                var tiefe = 1
                var i = m.range.last + 1
                while (i < c.length && tiefe > 0) { if (c[i] == '{') tiefe++ else if (c[i] == '}') tiefe--; i++ }
                if (inKoroutine(c, m.range.first) && call.containsMatchIn(c.substring(m.range.last + 1, i - 1)))
                    "${f.name}:${c.substring(0, m.range.first).count { it == '\n' } + 1}" else null
            }.toList()
        }
        assert(geprueft >= 10) { "Nur $geprueft runCatching gefunden — greift die Suche noch?" }
        assert(findings.isEmpty()) {
            "runCatching um einen suspendierenden Aufruf; fangeAusserAbbruch verwenden:\n  " + findings.joinToString("\n  ")
        }
    }

    @Test
    fun `kein breiter Fang verschluckt das Abbrechen eines suspendierenden Aufrufs`() {
        // Ein `catch (_: Exception)` um einen suspendierenden Aufruf fängt auch die
        // CancellationException; der abgebrochene Aufrufer liefe weiter. Dafür gibt
        // es fangeAusserAbbruch oder einen vorangestellten Abbruch-Zweig.
        val (texts, suche) = suspendCalls
        val namen = suche.first
        var geprueft = 0
        val findings = texts.flatMap { (f, c) ->
            val call = callIn(c)
            widerCatch.findAll(c).mapNotNull { m ->
                val swallows = swallowsAbort(c, m, call) ?: return@mapNotNull null
                geprueft++
                if (swallows) "${f.name}:${c.substring(0, m.range.first).count { it == '\n' } + 1}" else null
            }.toList()
        }
        assert(namen.size > 100 && geprueft >= 15) { "Nur ${namen.size} suspend-Funktionen, $geprueft Fänge — greift die Suche noch?" }
        assert(findings.isEmpty()) {
            "Breiter Fang um einen suspendierenden Aufruf ohne Abbruch-Zweig; fangeAusserAbbruch verwenden:\n  " +
                findings.joinToString("\n  ")
        }
    }

    @Test
    fun `die detekt-Baseline haelt nur Laenge und Verzweigung und schrumpft`() {
        val baseline = File(Quellen.project, "config/detekt/baseline.xml").readText()
        val ids = Regex("""<ID>(\w+):""").findAll(baseline).map { it.groupValues[1] }.toList()
        val grenze = File(Quellen.project, "tools/detekt-limit.txt").readLines()
            .first { it.isNotBlank() && !it.startsWith("#") }.trim().toInt()
        assert(ids.size >= 10) { "Nur ${ids.size} Einträge in der Baseline — Muster veraltet?" }
        val fremd = ids.filter { it !in setOf("LongMethod", "CyclomaticComplexMethod") }.distinct()
        assert(fremd.isEmpty()) { "Die Baseline verschweigt andere Regeln: $fremd. Den Fund beheben, nicht eintragen." }
        ratchet("Funktionen in der detekt-Baseline (tools/detekt-limit.txt)", grenze, ids.size,
            "Eine neue lange oder verzweigte Funktion zerlegen, statt sie einzutragen.")
    }

    @Test
    fun `Echtzeit-Warten in Tests wird weniger, nie mehr`() {
        // Ein Test, der schläft, ist langsam und auf einem vollen Runner brüchig. ViewModel-Tests
        // laufen im Takt (PfadServer.imTakt, Test-Dispatcher); gezählt wird, was noch wartet.
        val SLEEP = 2
        val WARTEN = 13
        val dateien = (Quellen.tests.walkTopDown() + File(Quellen.project, "core-testing/src/main").walkTopDown())
            .filter { it.isFile && it.extension == "kt" }.toList()
        val texts = dateien.map { code(it.readText()) }
        val sleep = texts.sumOf { Regex("""\bThread\.sleep\(""").findAll(it).count() }
        val warten = texts.sumOf { Regex("""\bwarteBis\(""").findAll(it).count() }
        assert(dateien.size > 200) { "Nur ${dateien.size} Testdateien gefunden — greift die Suche noch?" }
        val hinweis = "Neue Tests laufen im Takt: PfadServer.imTakt() oder FakeApi mit Test-Dispatcher."
        ratchet("Thread.sleep in Tests", SLEEP, sleep, hinweis)
        ratchet("warteBis in Tests", WARTEN, warten, hinweis)
    }

    private val publicDekl = Regex("""^(?:@[\w.:]+(?:\([^)\n]*\))?\s+)*((?:(?:public|internal|private|protected|data|sealed|abstract|open|enum|inline|value|annotation|const|suspend|operator|infix|tailrec|lateinit|fun interface)\s+)*)(?:fun\s+interface|class|interface|object|typealias|fun|val|var)\s""", RegexOption.MULTILINE)

    /** Öffentliche Deklarationen auf oberster Ebene im Hauptcode der [module]. */
    private fun oeffentlich(module: List<File>, mindestens: Int): Int {
        val dateien = module.flatMap { m ->
            File(m, "src/main").walkTopDown().filter { it.isFile && it.extension == "kt" }.toList()
        }
        assert(dateien.size > mindestens) { "Nur ${dateien.size} Dateien in ${module.map { it.name }} — greift die Suche noch?" }
        return dateien.sumOf { f ->
            publicDekl.findAll(f.readText()).count { "private" !in it.groupValues[1] && "internal" !in it.groupValues[1] }
        }
    }

    @Test
    fun `die oeffentliche Flaeche der Datenmodule waechst nicht`() {
        // Was nur das eigene Modul braucht, ist internal: Jede öffentliche Deklaration ist
        // Schnittstelle für alle Bereiche. Gezählt wird auf oberster Ebene, über core-data und
        // alles, was aus ihm abgespalten wird; sonst sänke die Zahl beim Verschieben zum Schein.
        // Darin UPDATE_FOLDER: öffentlich, weil core-data und core-update ihn teilen.
        val GRENZE = 222
        val andere = setOf("core-model", "core-contract", "core-resources", "core-ui", "core-ui-inventory", "core-state", "core-navigation", "core-session",
            "core-testing")
        val module = Quellen.module.filter { it.name.startsWith("core-") && it.name !in andere }
        assert("core-data" in module.map { it.name }) { "core-data nicht unter ${module.map { it.name }} — greift die Suche noch?" }
        ratchet("öffentliche Deklarationen in ${module.joinToString { it.name }}", GRENZE, oeffentlich(module, 100),
            "Was nur das Modul braucht, wird internal.")
    }

    @Test
    fun `die oeffentliche Flaeche der Bereiche waechst nicht`() {
        // Ein Bereich zeigt der App Routen und Ziele; was nur er selbst braucht, ist internal.
        // Noch öffentlich ist vieles, weil Graphen und Oberflächentests in app liegen.
        val GRENZE = 142
        val module = Quellen.module.filter { it.name.startsWith("feature-") }
        assert(module.size >= 7) { "Nur ${module.size} Bereiche — greift die Suche noch?" }
        ratchet("öffentliche Deklarationen der Bereiche", GRENZE, oeffentlich(module, 100),
            "Was nur der Bereich braucht, wird internal.")
    }

    /** Alle Kotlin-Dateien unter src/main, ohne Kommentare und Zeichenketten. */
    private fun hauptcode(): List<Pair<File, String>> = Quellen.module.map { File(it, "src/main") }.filter { it.isDirectory }
        .flatMap { d -> d.walkTopDown().filter { it.isFile && it.extension == "kt" }.toList() }
        .map { it to code(it.readText()) }

    @Test
    fun `feste Zahlen in padding werden nicht mehr`() {
        // Abstände haben Namen (ui/theme/Abstaende); ein blankes `padding(… 14.dp)` hält sich
        // an keine Skala, und zwei Karten nebeneinander stehen verschieden weit ein.
        val GRENZE = 46
        // Ebenso die Abstände zwischen Geschwistern: spacedBy und Spacer.
        val BETWEEN = 40
        val fest = Regex("""\bpadding\([^()]*?\b\d+(?:\.\d+)?\.dp""")
        val zwischen = Regex("""\bspacedBy\(\d+(?:\.\d+)?\.dp\)|\bSpacer\(Modifier\.(?:height|width)\(\d+(?:\.\d+)?\.dp\)\)""")
        val code = hauptcode()
        ratchet("padding mit fester dp-Zahl", GRENZE, code.sumOf { (_, text) -> fest.findAll(text).count() },
            "Einen Abstand aus Abstaende nehmen.")
        ratchet("spacedBy und Spacer mit fester dp-Zahl", BETWEEN, code.sumOf { (_, text) -> zwischen.findAll(text).count() },
            "Einen Abstand aus Abstaende nehmen.")
    }

    @Test
    fun `kein String-format ohne Locale`() {
        // Ohne Locale formatiert String.format nach dem Gerät, nicht nach der Sprache der App;
        // stringResource(id, …) oder appNumberLocale() nennen sie ausdrücklich.
        val ohne = Regex("""\bString\.format\(\s*(?!Locale|appNumberLocale|locale\b|java\.util\.Locale)""")
        val stellen = hauptcode().filter { (_, text) -> ohne.containsMatchIn(text) }.map { it.first.name }
        assertEquals("String.format ohne Locale in $stellen", emptyList<String>(), stellen)
    }

    /** Die Argumente eines Aufrufs bis zur passenden Klammer; [auf] zeigt auf die öffnende. */
    private fun arguments(text: String, auf: Int): String {
        var tiefe = 0
        var i = auf
        while (i < text.length) {
            if (text[i] == '(') tiefe++ else if (text[i] == ')' && --tiefe == 0) break
            i++
        }
        return text.substring(auf, minOf(i + 1, text.length))
    }

    @Test
    fun `kein AlertDialog ohne Fenstername und Ueberschrift`() {
        // Ohne paneTitle sagt TalkBack beim Öffnen nur „Dialog“, ohne heading() findet die
        // Überschriften-Navigation den Titel nicht. Rueckfrage und AddDialog setzen beides.
        val call = Regex("""\bAlertDialog\(""")
        var gesehen = 0
        val ohne = hauptcode().flatMap { (f, text) ->
            call.findAll(text).mapNotNull { m ->
                gesehen++
                val args = arguments(text, m.range.last)
                val fehlt = listOf("paneTitle", "heading()").filter { it !in args }
                val zeile = text.substring(0, m.range.first).count { it == '\n' } + 1
                if (fehlt.isEmpty()) null else "${f.name}:$zeile ohne ${fehlt.joinToString()}"
            }.toList()
        }
        assertTrue("Nur $gesehen AlertDialogs gefunden — greift die Suche noch?", gesehen >= 8)
        assertEquals("AlertDialogs ohne Fenstername oder Überschrift", emptyList<String>(), ohne)
    }

    @Test
    fun `jeder AlertDialog liegt auf der Fensterflaeche`() {
        // Materials surfaceContainerHigh stand im Hellen grau auf dem abgedunkelten Grund;
        // fensterFlaeche() nimmt dort surface (Kontrast belegt LockedContrastTest).
        val call = Regex("""\bAlertDialog\(""")
        var gesehen = 0
        val ohne = hauptcode().flatMap { (f, text) ->
            call.findAll(text).mapNotNull { m ->
                gesehen++
                val zeile = text.substring(0, m.range.first).count { it == '\n' } + 1
                if ("containerColor = fensterFlaeche()" in arguments(text, m.range.last)) null else "${f.name}:$zeile"
            }.toList()
        }
        assertTrue("Nur $gesehen AlertDialogs gefunden — greift die Suche noch?", gesehen >= 8)
        assertEquals("AlertDialogs ohne fensterFlaeche()", emptyList<String>(), ohne)
    }

    /** Aufruf samt nachgestelltem Block: `Row(…) { … }` oder `Row { … }`; [auf] zeigt auf `(` bzw. `{`. */
    private fun callWithBlock(text: String, auf: Int): String {
        val args = if (text[auf] == '(') arguments(text, auf) else ""
        var i = auf + args.length
        while (i < text.length && text[i].isWhitespace()) i++
        if (i >= text.length || text[i] != '{') return args
        var tiefe = 0
        var j = i
        while (j < text.length) {
            if (text[j] == '{') tiefe++ else if (text[j] == '}' && --tiefe == 0) break
            j++
        }
        return args + text.substring(i, minOf(j + 1, text.length))
    }

    @Test
    fun `Abbrechen und Hauptknopf stehen nur in der Knopfzeile beisammen`() {
        // Im Gutschein-Formular stand Speichern links und Abbrechen rechts, überall sonst
        // umgekehrt. AlertDialog ordnet selbst; jede andere Knopfreihe nimmt Knopfzeile. Ein
        // Schliessen-Kreuz neben „OK“ beim Bearbeiten in der Zeile ist kein Abbrechen-Knopf.
        val series = Regex("""\b(?:Row|FlowRow)\s*[({]""")
        val haupt = Regex("""(?<![\w.])(?:Button|FilledTonalButton)\(""")
        var gesehen = 0
        val eigene = hauptcode().filter { (f, _) -> f.name != "Dialoge.kt" }.flatMap { (f, text) ->
            series.findAll(text).mapNotNull { m ->
                gesehen++
                val inhalt = callWithBlock(text, m.range.last)
                val zeile = text.substring(0, m.range.first).count { it == '\n' } + 1
                if ("Text(stringResource(R.string.common_cancel))" in inhalt && haupt.containsMatchIn(inhalt)) "${f.name}:$zeile" else null
            }.toList()
        }
        assertTrue("Nur $gesehen Zeilen gefunden — greift die Suche noch?", gesehen >= 100)
        assertEquals("Eigene Knopfreihe mit Abbrechen und Hauptknopf; Knopfzeile nehmen",
            emptyList<String>(), eigene)
    }

    @Test
    fun `die Activity haelt nicht mehr ViewModels`() {
        // Activity-weit nur, was über jedem Ziel liegt (ActivityState) und die Pflichtmasken;
        // alles andere holt sein Ziel mit hiltViewModel() an seinem Eintrag.
        val GRENZE = 6
        val activity = Quellen.module.map { File(it, "src/main") }.filter { it.isDirectory }
            .flatMap { d -> d.walkTopDown().filter { it.isFile && it.name == "MainActivity.kt" }.toList() }
        assertEquals("genau eine MainActivity", 1, activity.size)
        val zahl = Regex("""\bby\s+viewModels\s*\(""").findAll(code(activity.single().readText())).count()
        ratchet("ViewModels an der Activity", GRENZE, zahl, "Ein ViewModel gehört an sein Ziel.")
    }

    @Test
    fun `kein voll qualifizierter Projektname im Code`() {
        // Ein Import zeigt die Abhängigkeit im Kopf der Datei; inline bleibt sie
        // unsichtbar und die Zeile lang. Kommentare und Zeichenketten zählen nicht.
        val voll = Regex("""(?<![\w.])ch\.brickinventoryapp(?:\.[a-z]\w*)+\.[A-Za-z_]\w*""")
        val dateien = productionFiles() + Quellen.tests.walkTopDown().filter { it.isFile && it.extension == "kt" }
        assert(dateien.size > 500) { "Nur ${dateien.size} Dateien gefunden — greift die Suche noch?" }
        val findings = dateien.flatMap { f ->
            code(f.readText()).lines().map { it.replace(Regex("//.*"), "") }
                .filterNot { it.trimStart().startsWith("import ") || it.trimStart().startsWith("package ") }
                .filter { voll.containsMatchIn(it) }.map { "${f.name}: ${it.trim()}" }
        }
        assert(findings.isEmpty()) { "Voll qualifizierte Namen; importieren statt ausschreiben:\n  " + findings.joinToString("\n  ") }
    }

    @Test
    fun `fully qualified names of foreign packages become fewer`() {
        // Ausgeschrieben nur bei echter Namensgleichheit, und dann besser mit `import … as`.
        val MAIN = 187
        val TESTS = 0
        val voll = Regex("""(?<![\w.@])(?:androidx|android|kotlinx|kotlin|java|javax|okhttp3|okio|retrofit2|com|org|coil3|dagger)(?:\.[a-z]\w*)+\.[A-Z]\w*""")
        fun zaehle(dateien: Sequence<File>) = dateien.sumOf { f ->
            code(f.readText()).lines().map { it.replace(Regex("//.*"), "") }
                .filterNot { it.trimStart().startsWith("import ") || it.trimStart().startsWith("package ") }
                .sumOf { voll.findAll(it).count() }
        }
        val haupt = zaehle(productionFiles().asSequence())
        val tests = zaehle(Quellen.tests.walkTopDown().filter { it.isFile && it.extension == "kt" })
        assertTrue("Keine voll qualifizierten Namen gefunden — greift das Muster noch?", haupt + tests > 0)
        ratchet("voll qualifizierte Namen im Hauptcode", MAIN, haupt)
        ratchet("voll qualifizierte Namen in Tests", TESTS, tests)
    }

    @Test
    fun `Bildschirme stossen das Laden nicht per LaunchedEffect an, Zustaende tragen Laden und Meldung`() {
        // Ziel 0: Das ViewModel lädt selbst (init, observeLoadOn); der Bildschirm ruft
        // höchstens aktualisiere() auf eine Geste hin. Gezählt: LaunchedEffect mit lade…/load…-Aufruf.
        val LOADING = 0
        val effect = Regex("""\bLaunchedEffect\([^)]*\)\s*\{([^{}]*(?:\{[^{}]*\}[^{}]*)*)\}""")
        val lader = Regex("""\b(?:lade|load)[A-Z]\w*\s*\(""")
        val findings = productionFiles().flatMap { f ->
            effect.findAll(code(f.readText())).filter { lader.containsMatchIn(it.groupValues[1]) }.map { f.name }.toList()
        }
        assertTrue("Kein LaunchedEffect gefunden — greift das Muster noch?",
            productionFiles().any { "LaunchedEffect(" in it.readText() })
        ratchet("LaunchedEffect, die laden", LOADING, findings.size, findings.joinToString())
        // Ein Bildschirmzustand trägt Laden<T> (Abruf) oder Vorgang (Handlung) statt eines Paars
        // aus `laeuft: Boolean` und `fehler: String?`, und Meldung oder Fehlerklasse statt eines
        // übersetzten Satzes: Der Satz entsteht beim Zeichnen, in der Sprache von dann.
        val ALT = 0
        val TEXT = 0
        val laden = Regex("""(?i)^(laedt\w*|laden|\w*loading|\w*laedt|\w*laeuft|speichert|sendet|prueft|\w*ing)$""")
        val text = Regex("""(?i)(fehler|error|meldung|message|hinweis)""")
        val zustand = Regex("""data class [A-Za-z0-9_]*(UiState|Zustand)\b""")
        var alt = 0
        var states = 0
        var texts = 0
        for ((modul, zeilen) in rowsPerModule()) {
            if (presentation.none { modul.startsWith(it) }) continue
            val isState = zustand.containsMatchIn(zeilen.joinToString("\n"))
            if (isState) states++
            for (z in zeilen) {
                val m = eigenschaft.find(z) ?: continue
                val (name, typ) = m.destructured
                if (typ == "Boolean" && laden.matches(name)) alt++
                if (isState && typ != "Boolean" && text.containsMatchIn(name)) texts++
            }
        }
        // Beide Zahlen stehen auf 0; dass das Muster noch greift, zeigt eine alte Form.
        val unrecognized = listOf("galleryLoading", "bestandLaeuft", "isExporting", "speichert", "laedtPruefung")
            .filterNot { erkannt(laden, it) }
        assertTrue("Das Muster erkennt $unrecognized nicht mehr", unrecognized.isEmpty())
        assertTrue("Nur $states Zustandsdateien — greift die Suche noch?", states >= 10)
        ratchet("alte Ladeformen (Boolean laedt/…laeuft/speichert/…ing)", ALT, alt,
            "Laden<T> (model/ui/Laden.kt) für Abrufe, Vorgang (model/ui/Vorgang.kt) für Handlungen nehmen.")
        ratchet("fertige Texte im Zustand (String fehler/meldung/…)", TEXT, texts,
            "Meldung (model/ui/Meldung.kt) oder Fehlerklasse ablegen, den Satz bildet der Bildschirm.")
    }

    @Test
    fun `Fachtypen tragen Betraege als Geld und Zeitpunkte als Instant, nicht als Double und String`() {
        // Ziel 0, beide erreicht: Gezählt werden Eigenschaften in core-model, deren Name einen Betrag
        // oder ein Datum nennt. Prozente sind keine Beträge.
        val AMOUNTS = 0
        val DATA = 0
        val propertyType = Regex("""\bva[lr]\s+(\w+)\s*:\s*(Double|String)\b""")
        val betrag = Regex("""(?i)(price|preis|betrag|amount|wert|schwelle|value|kosten)""")
        val share = Regex("""(?i)(prozent|pct|frac)""")
        val datum = Regex("""(At|Am|Datum|Date)$|^(datum|date|tag)$""")
        fun zaehle(zeilen: List<String>): Pair<List<String>, List<String>> {
            val treffer = zeilen.flatMap { z -> propertyType.findAll(z).map { it.groupValues[1] to it.groupValues[2] }.toList() }
            return treffer.filter { (n, t) -> t == "Double" && betrag.containsMatchIn(n) && !share.containsMatchIn(n) }.map { it.first } to
                treffer.filter { (n, t) -> t == "String" && datum.containsMatchIn(n) }.map { it.first }
        }
        val probe = zaehle(listOf("    val avgPrice: Double? = null,", "    val createdAt: String? = null,", "    val pnlProzent: Double? = null,"))
        assertEquals("Das Muster erkennt die alten Formen nicht mehr", listOf("avgPrice") to listOf("createdAt"), probe)
        val (money, days) = zaehle(rowsPerModule().filter { it.first == "core-model" }.flatMap { it.second })
        ratchet("Beträge als Double in core-model", AMOUNTS, money.size, "Geld nehmen (model/domain/Geld.kt): $money")
        ratchet("Daten als String in core-model", DATA, days.size, "Instant nehmen, gelesen mit zeitpunkt(): $days")
    }
    /** Ob [pattern] eine Boolean-Eigenschaft dieses Namens als alte Ladeform zählt. */
    private fun erkannt(pattern: Regex, name: String): Boolean =
        eigenschaft.find("    val $name: Boolean = false,")?.destructured?.component1()?.let(pattern::matches) == true

    /** Die Hauptquellen eines Moduls, Zeile für Zeile; die Regeln unten lesen nur Zeilenanfänge. */
    private fun rowsPerModule(): List<Pair<String, List<String>>> = Quellen.module.flatMap { m ->
        File(m, "src/main/java").walkTopDown().filter { it.isFile && it.extension == "kt" }
            .map { m.name to it.readText().split("\n") }.toList()
    }

    private val eigenschaft = Regex("""^\s*(?:(?:private|internal|public|override)\s+)*(?:val|var)\s+([A-Za-z_][A-Za-z0-9_]*)\s*:\s*(Boolean|String\?|String)(?![A-Za-z0-9_<?])""")
    private val presentation = listOf("feature-", "core-state", "core-session", "app")
}
