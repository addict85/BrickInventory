package ch.brickinventoryapp.app

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File
import ch.brickinventoryapp.testing.Quellen

/**
 * Ratchets: numbers that may only sink. Each stands exactly at the measured value;
 * if it rises, the test is red, if it sinks, it demands to adjust the limit.
 * A regex on the source only confirms that a line is there; counted is
 * how many test functions still do that. Counterpart to Web-App/test/ratschen.test.js.
 *
 * Counter-checks (patches under gegenproben/):
 *   schranke-zu-hoch           limit of the source-reading functions +1 → red “test functions
 *                              that read source …” (sunk, adjust)
 *   helfer-zaehlt-nicht        a reading helper no longer counts → red, the same test
 *   werkzeugausgabe-zaehlt     the output of a tool counts as source again → red “the output
 *                              of a tool …” and “test functions that read source …”
 *   geschichte-im-testkopf     addendum number and reporter in the header of TabOpensAtTopTest → red “long
 *                              comments in the workflow and in tests …”
 *   kuerzel-im-bau             a check abbreviation again in the comment of settings.gradle.kts → red, the same test
 *   kommentar-zu-lang          six lines of prose above AppViewModel → red “no comment has …”
 *   bau-kommentar-zu-lang      six lines in gradle.properties → red “no comment in build files …”
 *   verweis-aufs-archiv        an „Ausführlich: docs/begruendungen/…“ in TokenTresor.kt → red “no reference
 *                              to the reasoning archive …”
 *   kdoc-doppelt               an orphaned KDoc block before Alarmabholung → red, the same test
 *   detekt-baseline-waechst    upper limit one below the entries → red “the detekt baseline …”
 *   detekt-baseline-fremde-regel  a MagicNumber entry → red, the same test
 *   start-schluckt-abbruch     makes “no broad catch …” red
 *   runcatching-um-suspend     BrickInventoryApp takes over the old token in runCatching again
 *                              → red “no runCatching swallows …”
 *   runcatching-um-suspend-lambda  Offlineablage calls the suspend source (a field of type
 *                              `suspend () -> String?`) in runCatching → red, the same test
 *   voll-qualifiziert          `ch.brickinventoryapp.model.util.fangeAusserAbbruch` written out → red
 *                              “no fully qualified project name …” and “fully qualified names …”
 *   warten-in-echtzeit         PartsViewModelTest sleeps 200 ms again → red “real-time waiting …”
 *   core-data-oeffentlich      liesBelow without internal → red “the public surface of the data modules …”
 *   bereich-oeffentlich        qrSwitchesServer without internal → red “the public surface of the areas …”
 *   erfassung-an-der-activity  EntryViewModel again via `by viewModels()` in MainActivity
 *                              → red “the activity no longer holds ViewModels …”
 *   padding-feste-zahl         DetailRow2 again `padding(vertical = 5.dp)` → red “fixed numbers in padding …”
 *   abstand-zwischen-feste-zahl  storage locations again `Spacer(Modifier.width(8.dp))` → red, the same test
 *   dialog-ohne-fenstername    UpdateDialog without paneTitle → red “no AlertDialog without window name …”
 *   dialog-graue-flaeche       UpdateDialog without fensterFlaeche() → red “every AlertDialog lies on the window surface“
 *   gutschein-eigene-knopfreihe  voucher form again with its own row Save | Cancel
 *                              → red “Cancel and main button stand together only in the button row …”
 *   string-format-ohne-locale  MonitoringScreen again `String.format(fmt, sn)` → red “no String-format …”
 *   laden-im-bildschirm        SetDetailScreen loads via LaunchedEffect(setNumber) again
 *                              → red “screens do not trigger loading …”
 *   merkliste-laedt-wieder     WantedUiState again with a field `nochLaedt: Boolean` → red
 *                              “screens do not trigger loading …, states carry loading …”
 *   merkliste-fehler-als-text  WantedUiState with `errorText: String?` → red, the same test
 *   konto-speichert-wieder     AccountUiState again with `speichert: Boolean` → red, the same test
 *   galerie-fehler-als-text    GalleryUiState with `galleryFehlerSatz: String?` → red, the same test
 *   fachtyp-preis-als-double   `val betragAlt: Double?` in PurchaseSumsView → red „Beträge als Double …“
 *   fachtyp-datum-als-text     `val geaendertAm: String?` in KaufAnsicht → red „Daten als String …“
 */
class QuelltextRatscheTest {

    private val string = Regex("\"\"\"[\\s\\S]*?\"\"\"|\"(?:\\\\.|[^\"\\\\\n])*\"")

    /** Without comments and strings: a file name like "GalleryScreen.kt" is not a call. */
    private fun code(roh: String) = string.replace(Quellen.withoutComments(roh), "\"\"")

    /** Equality: if the number rises, that is an error; if it sinks, the limit is adjusted. */
    private fun ratchet(was: String, limit: Number, gemessen: Number, hinweis: String = "") {
        assertTrue("$was: $gemessen, erlaubt $limit. $hinweis", gemessen.toDouble() <= limit.toDouble())
        assertEquals("$was ist auf $gemessen gesunken — die Schranke von $limit auf $gemessen senken",
            limit.toDouble(), gemessen.toDouble(), 0.0)
    }

    /**
     * What counts as reading source: Quellen.*, paths under src/main, workflow, resources,
     * file text. The output of a started tool (`bufferedReader().readText()`) is
     * a result, not source.
     */
    private val readsSource = Regex("""Quellen\.|"src/main/|File\("src/main|\.\./\.\./\.github|res/values|(?<!bufferedReader\(\)\.)readText\(\)|readLines\(\)""")

    /**
     * (test functions, of which reading) of a file. A function reads source if its body
     * does or uses a value or function of the file that does.
     */
    internal fun sourceTextFunctions(roh: String): Pair<Int, Int> {
        val c = Quellen.withoutComments(roh)
        val helper = Regex("""(?:val|fun)\s+(\w+)[^\n]*""").findAll(c).filter { m ->
            val stueck = c.substring(m.range.first, minOf(c.length, m.range.first + 400)).substringBefore("\n\n")
            readsSource.containsMatchIn(m.value) || (m.value.startsWith("fun") && readsSource.containsMatchIn(stueck))
        }.map { it.groupValues[1] }.toSet()
        // The name in backticks is prose, not code: "the workflow …" does not call a helper `workflow`.
        val tests = c.split(Regex("""@Test\b""")).drop(1).map { it.substringBefore("\n    }\n").replace(Regex("`[^`\n]*`"), "``") }
        val lesend = tests.count { t -> readsSource.containsMatchIn(t) || helper.any { Regex("""\b${Regex.escape(it)}\b""").containsMatchIn(t) } }
        return tests.size to lesend
    }

    @Test
    fun `test functions that read source become fewer, never more`() {
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
    fun `a reading helper counts for every function that uses it`() {
        val datei = "private val src = Quellen.lies(\"x.kt\")\n" +
            "@Test\nfun a() {\n    assert(\"y\" in src)\n    }\n" +
            "@Test\nfun b() {\n    assert(1 + 1 == 2)\n    }\n"
        assertEquals(2 to 1, sourceTextFunctions(datei))
    }

    @Test
    fun `the output of a tool is not source`() {
        val datei = "private fun lauf() = ProcessBuilder(\"python3\").start().inputStream.bufferedReader().readText()\n" +
            "@Test\nfun a() {\n    assert(\"ok\" in lauf())\n    }\n\n" +
            "@Test\nfun b() {\n    assert(\"x\" in File(\"y\").readText())\n    }\n"
        assertEquals(2 to 1, sourceTextFunctions(datei))
    }

    /** The Kotlin files under src/main of all modules, without those generated from the design tokens. */
    private fun productionFiles(): List<File> = Quellen.module.flatMap { m ->
        File(m, "src/main").walkTopDown().filter { it.isFile && it.extension == "kt" }.toList()
    }.filterNot { "GENERATED from shared/design-tokens.json" in it.readText() }

    private val counterCheck = Regex("Gegenprobe|Counter-check", RegexOption.IGNORE_CASE)

    private fun isComment(t: String) = t.startsWith("//") || t.startsWith("*") || t.startsWith("/*")

    /** Prose lines per comment block (// sequence of equal indentation or /* … */), without KDoc tags. */
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

    /** Prose lines without KDoc tags; a tag applies up to the next empty line. */
    private fun prose(text: List<String>): Int {
        var inTag = false
        return text.count { z ->
            if (z.startsWith("@")) inTag = true else if (z.isEmpty()) inTag = false
            z.isNotEmpty() && !inTag
        }
    }

    @Test
    fun `the comment share sinks, never rises`() {
        // A share, not a number: it may sink without anyone having to adjust.
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
    fun `no comment has more than five lines of prose`() {
        var gezaehlt = 0
        val lang = productionFiles().flatMap { f ->
            blocks(f.readLines()).also { gezaehlt += it.size }
                .filter { it.second > 5 }.map { "${f.name}:${it.first} (${it.second} Zeilen)" }
        }
        assert(gezaehlt > 1000) { "Nur $gezaehlt Kommentarblöcke gefunden — greift die Suche noch?" }
        assert(lang.isEmpty()) { "Kommentare über fünf Zeilen; das Warum kürzen, die Geschichte in den Commit:\n  " + lang.joinToString("\n  ") }
    }

    /** Prose lines per `#` block (equal indentation); empty `#` lines do not count. */
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

    /** Build scripts of all modules, build-logic, catalog and gradle.properties. */
    private fun baudateien(): List<File> =
        Quellen.module.map { File(it, "build.gradle.kts") }.filter { it.isFile } +
            listOf("build.gradle.kts", "settings.gradle.kts", "gradle/libs.versions.toml", "gradle.properties")
                .map { File(Quellen.project, it) }.filter { it.isFile } +
            File(Quellen.project, "build-logic").walkTopDown()
                .filter { it.isFile && (it.extension == "kt" || it.name.endsWith(".gradle.kts")) && "/build/" !in it.invariantSeparatorsPath }

    @Test
    fun `no comment in build files has more than five lines of prose`() {
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
    fun `long comments in the workflow and in tests become fewer`() {
        val WORKFLOW = 1
        val TESTS = 50
        val DATE_AND_ID = 0
        val HISTORY = 0
        val wf = File(Quellen.project, "../.github/workflows/android.yml").readLines()
        val wfLang = hashesBlocks(wf).filter { it.second > 5 }
        // In tests a paragraph may only be longer if it enumerates the counter-checks.
        val dateien = Quellen.tests.walkTopDown().filter { it.isFile && it.extension == "kt" }.toList()
        val testLang = dateien.flatMap { f -> longParagraphs(f.readLines()).map { "${f.name}:$it" } }
        val kennung = Regex("""[0-9]{2}\.[0-9]{2}\.20[0-9]{2}|\b(?:arch|sec|ux|perf)[0-9]+\b|\bhardened-[0-9]+""")
        val history = dateien.flatMap { f ->
            f.readLines().filter { z ->
                val t = z.trim()
                (t.startsWith("//") || t.startsWith("*") || t.startsWith("/*")) &&
                    kennung.containsMatchIn(t) && !counterCheck.containsMatchIn(t)
            }.map { "${f.name}: ${it.trim()}" }
        }
        // Who reported what and in which addendum belongs in the commit, not in the test header.
        val narrative = Regex("""Nachtr[aä]g\w*\s+[0-9]|\bMarcos?\b|Woher dies|\bLauf [0-9]{2,}|CI-Lauf|\bRunde [0-9]+|Addendum\w*\s+[0-9]|\bRun [0-9]{2,}|CI run|\bRound [0-9]+""")
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
        // In code and build files a comment names the why, not the check that found it.
        val abbreviation = Regex("""\((?:sec|arch|ux|perf)[0-9]+[^)]*\)|\((?:[HMN][0-9]{1,2})\)|\bNachtrag [0-9]+""")
        val gekuerzt = (productionFiles() + baudateien()).flatMap { f ->
            f.readLines().filter { z -> z.trim().let { isComment(it) || it.startsWith("#") } && abbreviation.containsMatchIn(z) }
                .map { "${f.name}: ${it.trim()}" }
        }
        ratchet("Prüfungskürzel in Kommentaren von Code und Bau", 0, gekuerzt.size, gekuerzt.take(20).joinToString("\n  "))
    }

    /** Line numbers of comment paragraphs over five prose lines that do not begin with „Gegenprobe“ or „Counter-check“. */
    private fun longParagraphs(zeilen: List<String>): List<Int> {
        val findings = mutableListOf<Int>()
        var anfang = -1
        val paragraph = mutableListOf<String>()
        fun schliessen() {
            if (paragraph.size > 5 && !paragraph.first().let { it.startsWith("Gegenprobe") || it.startsWith("Counter-check") }) findings += anfang + 1
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
    fun `no reference to the reasoning archive, and no KDoc hangs on nothing`() {
        // The archive docs/begruendungen is no longer in the tree; the why stands in the comment,
        // the history in the commit. A second KDoc block directly before hangs on nothing.
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

    /** Index of the opening bracket for the closing one at [zu], -1 if none. */
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

    /** true if the catch has no cancellation branch and its try body contains [call]; null without try. */
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

    /** The app's sources and a pattern for calling one of its suspend functions. */
    private val suspendCalls: Pair<Map<File, String>, Pair<Set<String>, Regex>> by lazy {
        val texts = productionFiles().associateWith { code(it.readText()) }
        val namen = texts.values.flatMap { c ->
            Regex("""\bsuspend\s+fun\s+(?:<[^>]*>\s*)?(?:\w+\.)?(\w+)""").findAll(c).map { it.groupValues[1] }.toList()
        }.toSet() + setOf("collect", "withContext", "withLock", "delay", "await", "join", "emit", "first")
        texts to (namen to Regex("""\b(?:${namen.joinToString("|")})\s*[({]"""))
    }

    /** Parameters and fields with a suspend function type (`quelle: suspend () -> T`); a name only in their file. */
    private val suspendType = Regex("""\b(\w+)\s*:\s*\(?\s*suspend\b""")

    /** The call pattern for [c]: the app's suspend functions and the file's suspend lambdas. */
    private fun callIn(c: String): Regex {
        val (namen, _) = suspendCalls.second
        val alle = namen + suspendType.findAll(c).map { it.groupValues[1] }
        return Regex("""\b(?:${alle.joinToString("|")})\s*[({]""")
    }

    private val koroutinenBlock = Regex("""\b(?:launch|async|runBlocking|withContext\([^()]*\)|coroutineScope|supervisorScope|flow|runTest)\s*(?:\([^()]*\))?\s*$""")

    /** Does the place [ab] run in a suspend function or a coroutine block? Only there is there a cancellation to swallow. */
    private fun inKoroutine(c: String, ab: Int): Boolean {
        val davor = c.substring(maxOf(0, ab - 300), ab)
        val instruction = davor.substring(maxOf(davor.lastIndexOf('{'), davor.lastIndexOf('}')) + 1)
        // Also `= gueltig(runCatching {`: the expression of a suspend fun runs entirely in it.
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
    fun `no runCatching swallows the cancellation of a suspending call`() {
        // runCatching also catches the CancellationException like a broad catch; the
        // cancelled caller would keep running. fangeAusserAbbruch exists for that.
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
    fun `no broad catch swallows the cancellation of a suspending call`() {
        // A `catch (_: Exception)` around a suspending call also catches the
        // CancellationException; the cancelled caller would keep running. For that there
        // is fangeAusserAbbruch or a preceding cancellation branch.
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
    fun `the detekt baseline holds only length and branching and shrinks`() {
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
    fun `real-time waiting in tests becomes less, never more`() {
        // A test that sleeps is slow and brittle on a busy runner. ViewModel tests
        // run in ticks (PfadServer.imTakt, test dispatcher); counted is what still waits.
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

    /** Public top-level declarations in the main code of the [module]. */
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
    fun `the public surface of the data modules does not grow`() {
        // What only the own module needs is internal: every public declaration is
        // interface for all areas. Counted at the top level, across core-data and
        // everything split off from it; otherwise the number would sink spuriously when moving.
        // Among them UPDATE_FOLDER: public because core-data and core-update share it.
        val GRENZE = 222
        val andere = setOf("core-model", "core-contract", "core-resources", "core-ui", "core-ui-inventory", "core-state", "core-navigation", "core-session",
            "core-testing")
        val module = Quellen.module.filter { it.name.startsWith("core-") && it.name !in andere }
        assert("core-data" in module.map { it.name }) { "core-data nicht unter ${module.map { it.name }} — greift die Suche noch?" }
        ratchet("öffentliche Deklarationen in ${module.joinToString { it.name }}", GRENZE, oeffentlich(module, 100),
            "Was nur das Modul braucht, wird internal.")
    }

    @Test
    fun `the public surface of the areas does not grow`() {
        // An area shows the app routes and destinations; what only it needs itself is internal.
        // Much is still public because graphs and UI tests live in app.
        val GRENZE = 142
        val module = Quellen.module.filter { it.name.startsWith("feature-") }
        assert(module.size >= 7) { "Nur ${module.size} Bereiche — greift die Suche noch?" }
        ratchet("öffentliche Deklarationen der Bereiche", GRENZE, oeffentlich(module, 100),
            "Was nur der Bereich braucht, wird internal.")
    }

    /** All Kotlin files under src/main, without comments and strings. */
    private fun hauptcode(): List<Pair<File, String>> = Quellen.module.map { File(it, "src/main") }.filter { it.isDirectory }
        .flatMap { d -> d.walkTopDown().filter { it.isFile && it.extension == "kt" }.toList() }
        .map { it to code(it.readText()) }

    @Test
    fun `fixed numbers in padding do not increase`() {
        // Spacings have names (ui/theme/Abstaende); a bare `padding(… 14.dp)` keeps to
        // no scale, and two cards side by side are indented differently.
        val GRENZE = 46
        // Likewise the spacings between siblings: spacedBy and Spacer.
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
    fun `no String-format without Locale`() {
        // Without a Locale String.format formats by the device, not by the app's language;
        // stringResource(id, …) or appNumberLocale() name it explicitly.
        val ohne = Regex("""\bString\.format\(\s*(?!Locale|appNumberLocale|locale\b|java\.util\.Locale)""")
        val stellen = hauptcode().filter { (_, text) -> ohne.containsMatchIn(text) }.map { it.first.name }
        assertEquals("String.format ohne Locale in $stellen", emptyList<String>(), stellen)
    }

    /** The arguments of a call up to the matching bracket; [auf] points to the opening one. */
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
    fun `no AlertDialog without window name and heading`() {
        // Without paneTitle TalkBack only says „Dialog“ when opening, without heading() the
        // heading navigation does not find the title. Rueckfrage and AddDialog set both.
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
    fun `every AlertDialog lies on the window surface`() {
        // Material's surfaceContainerHigh stood gray on the dimmed background in light mode;
        // fensterFlaeche() takes surface there (contrast proven by LockedContrastTest).
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

    /** Call including trailing block: `Row(…) { … }` or `Row { … }`; [auf] points to `(` or `{`. */
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
    fun `Cancel and main button stand together only in the button row`() {
        // In the voucher form Save stood on the left and Cancel on the right, everywhere else
        // the other way round. AlertDialog orders itself; every other button row takes Knopfzeile. A
        // close cross next to „OK“ when editing in the row is not a cancel button.
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
    fun `the activity no longer holds ViewModels`() {
        // Activity-wide only what lies above every destination (ActivityState) and the mandatory forms;
        // everything else gets its destination with hiltViewModel() at its entry.
        val GRENZE = 6
        val activity = Quellen.module.map { File(it, "src/main") }.filter { it.isDirectory }
            .flatMap { d -> d.walkTopDown().filter { it.isFile && it.name == "MainActivity.kt" }.toList() }
        assertEquals("genau eine MainActivity", 1, activity.size)
        val zahl = Regex("""\bby\s+viewModels\s*\(""").findAll(code(activity.single().readText())).count()
        ratchet("ViewModels an der Activity", GRENZE, zahl, "Ein ViewModel gehört an sein Ziel.")
    }

    @Test
    fun `no fully qualified project name in the code`() {
        // An import shows the dependency at the head of the file; inline it stays
        // invisible and the line long. Comments and strings do not count.
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
        // Written out only for a real name clash, and then better with `import … as`.
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
    fun `screens do not trigger loading via LaunchedEffect, states carry loading and message`() {
        // Target 0: the ViewModel loads itself (init, observeLoadOn); the screen calls
        // at most aktualisiere() in response to a gesture. Counted: LaunchedEffect with a lade…/load… call.
        val LOADING = 0
        val effect = Regex("""\bLaunchedEffect\([^)]*\)\s*\{([^{}]*(?:\{[^{}]*\}[^{}]*)*)\}""")
        val lader = Regex("""\b(?:lade|load)[A-Z]\w*\s*\(""")
        val findings = productionFiles().flatMap { f ->
            effect.findAll(code(f.readText())).filter { lader.containsMatchIn(it.groupValues[1]) }.map { f.name }.toList()
        }
        assertTrue("Kein LaunchedEffect gefunden — greift das Muster noch?",
            productionFiles().any { "LaunchedEffect(" in it.readText() })
        ratchet("LaunchedEffect, die laden", LOADING, findings.size, findings.joinToString())
        // A screen state carries Laden<T> (fetch) or Vorgang (action) instead of a pair
        // of `laeuft: Boolean` and `fehler: String?`, and Meldung or error class instead of a
        // translated sentence: the sentence arises when drawing, in the language of then.
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
        // Both numbers stand at 0; that the pattern still applies is shown by an old form.
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
    fun `domain types carry amounts as Money and points in time as Instant, not as Double and String`() {
        // Target 0, both reached: counted are properties in core-model whose name names an amount
        // or a date. Percentages are not amounts.
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
    /** Whether [pattern] counts a Boolean property of this name as an old loading form. */
    private fun erkannt(pattern: Regex, name: String): Boolean =
        eigenschaft.find("    val $name: Boolean = false,")?.destructured?.component1()?.let(pattern::matches) == true

    /** The main sources of a module, line by line; the rules below read only line starts. */
    private fun rowsPerModule(): List<Pair<String, List<String>>> = Quellen.module.flatMap { m ->
        File(m, "src/main/java").walkTopDown().filter { it.isFile && it.extension == "kt" }
            .map { m.name to it.readText().split("\n") }.toList()
    }

    private val eigenschaft = Regex("""^\s*(?:(?:private|internal|public|override)\s+)*(?:val|var)\s+([A-Za-z_][A-Za-z0-9_]*)\s*:\s*(Boolean|String\?|String)(?![A-Za-z0-9_<?])""")
    private val presentation = listOf("feature-", "core-state", "core-session", "app")
}
