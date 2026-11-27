package ch.brickinventoryapp.app

import ch.brickinventoryapp.testing.Sources
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

/**
 * Ratchets: numbers that may only sink. Each stands exactly at the measured value;
 * if it rises, the test is red, if it sinks, it demands to adjust the limit.
 * A regex on the source only confirms that a line is there; counted is
 * how many test functions still do that. Counterpart to Web-App/test/ratschen.test.js.
 *
 * Counter-checks (patches under counter-checks/):
 *   barrier-too-high           limit of the source-reading functions +1 → red “test functions
 *                              that read source …” (sunk, adjust)
 *   helper-does-not-count        a reading helper no longer counts → red, the same test
 *   tool-output-counts     the output of a tool counts as source again → red “the output
 *                              of a tool …” and “test functions that read source …”
 *   history-in-test-header     addendum number and reporter in the header of TabOpensAtTopTest → red “long
 *                              comments in the workflow and in tests …”
 *   abbreviation-in-build             a check abbreviation again in the comment of settings.gradle.kts → red, the same test
 *   comment-too-long          six lines of prose above AppViewModel → red “no comment has …”
 *   build-comment-too-long      six lines in gradle.properties → red “no comment in build files …”
 *   reference-to-archive        an „Ausführlich: docs/begruendungen/…“ in TokenVault.kt → red “no reference
 *                              to the reasoning archive …”
 *   kdoc-twice               an orphaned KDoc block before Alarmabholung → red, the same test
 *   detekt-baseline-grows    upper limit one below the entries → red “the detekt baseline …”
 *   detekt-baseline-foreign-rule  a MagicNumber entry → red, the same test
 *   start-swallows-cancellation     makes “no broad catch …” red
 *   (local) `(lists.metrics() as? Outcome.Success)?.let { … }` back in Parts.kt → red “no load
 *                              result is dropped silently” [Parts.kt:…]
 *   runcatching-um-suspend     BrickInventoryApp takes over the old token in runCatching again
 *                              → red “no runCatching swallows …”
 *   runcatching-around-suspend-lambda  Offlineablage calls the suspend source (a field of type
 *                              `suspend () -> String?`) in runCatching → red, the same test
 *   fully-qualified          `ch.brickinventoryapp.model.util.catchUnlessCancelled` written out → red
 *                              “no fully qualified project name …” and “fully qualified names …”
 *   wait-in-real-time         PartsViewModelTest sleeps 200 ms again → red “real-time waiting …”
 *   core-data-public      partListsStore without internal → red “the public surface of the data modules …”
 *   scope-public        qrSwitchesServer without internal → red “the public surface of the areas …”
 *   capture-on-the-activity  EntryViewModel again via `by viewModels()` in MainActivity
 *                              → red “the activity no longer holds ViewModels …”
 *   padding-fixed-number         DetailRow2 again `padding(vertical = 5.dp)` → red “fixed numbers in padding …”
 *   spacing-between-fixed-number  storage locations again `Spacer(Modifier.width(8.dp))` → red, the same test
 *   dialog-without-window-name    SetCheckDialog without paneTitle → red “no AlertDialog without window name …”
 *   dialog-grey-surface       SetCheckDialog without windowSurface() → red “every AlertDialog lies on the window surface“
 *   voucher-own-button-row  voucher form again with its own row Save | Cancel
 *                              → red “Cancel and main button stand together only in the button row …”
 *   string-format-without-locale  MonitoringScreen again `String.format(fmt, sn)` → red “no String-format …”
 *   load-in-screen        SetDetailScreen loads via LaunchedEffect(setNumber) again
 *                              → red “screens do not trigger loading …”
 *   wanted-list-loads-again     WantedUiState again with a field `nochLaedt: Boolean` → red
 *                              “screens do not trigger loading …, states carry loading …”
 *   wanted-list-error-as-text  WantedUiState with `errorText: String?` → red, the same test
 *   account-saves-again     AccountUiState again with `saves: Boolean` → red, the same test
 *   gallery-error-as-text    GalleryUiState with `galleryFehlerSatz: String?` → red, the same test
 *   domain-type-price-as-double   `val betragAlt: Double?` in PurchaseSumsView → red „Beträge als Double …“
 *   domain-type-date-as-text     `val geaendertAm: String?` in PurchaseView → red „Daten als String …“
 * Language (word list app/src/test/resources/german-words.txt; local JUnit, no patch yet):
 *   `fun ladeDaten()` in GalleryViewModel → red „German declarations …: ladeDaten“
 *   a file data/repository/Ergebnis.kt → red „German file names …: [Ergebnis.kt]“
 *   `// Lädt die Liste neu` in OutboxWorker.kt → red „German comment words …“ (expected 0, was 1)
 *   `assertEquals("Die Meldung fehlt", "broken", …)` in AbortTest → red “assertion messages are English”
 *   `val preisKonto` in Contract.kt → red „German declarations …: preisKonto“
 */
class SourceRatchetTest {

    private val string = Regex("\"\"\"[\\s\\S]*?\"\"\"|\"(?:\\\\.|[^\"\\\\\n])*\"")

    /** Without comments and strings: a file name like "GalleryScreen.kt" is not a call. */
    private fun code(raw: String) = string.replace(Sources.withoutComments(raw), "\"\"")

    /** Equality: if the number rises, that is an error; if it sinks, the limit is adjusted. */
    private fun ratchet(was: String, limit: Number, measured: Number, hint: String = "") {
        assertTrue("$was: $measured, allowed $limit. $hint", measured.toDouble() <= limit.toDouble())
        assertEquals("$was has dropped to $measured — lower the limit from $limit to $measured",
            limit.toDouble(), measured.toDouble(), 0.0)
    }

    /**
     * What counts as reading source: Quellen.*, paths under src/main, workflow, resources,
     * file text. The output of a started tool (`bufferedReader().readText()`) is
     * a result, not source.
     */
    private val readsSource = Regex("""Sources\.|"src/main/|File\("src/main|\.\./\.\./\.github|res/values|(?<!bufferedReader\(\)\.)readText\(\)|readLines\(\)""")

    /**
     * (test functions, names of those reading) of a file. A function reads source if its body
     * does or uses a value or function of the file that does.
     */
    internal fun readingTests(raw: String): Pair<Int, List<String>> {
        val c = Sources.withoutComments(raw)
        val helper = Regex("""(?:val|fun)\s+(\w+)[^\n]*""").findAll(c).filter { m ->
            val piece = c.substring(m.range.first, minOf(c.length, m.range.first + 400)).substringBefore("\n\n")
            // A function, or a value computed in a block (`by lazy {`), reads if its block does.
            val block = m.value.startsWith("fun") || m.value.trimEnd().endsWith("{") || m.value.trimEnd().endsWith("=")
            readsSource.containsMatchIn(m.value) || (block && readsSource.containsMatchIn(piece))
        }.map { it.groupValues[1] }.toSet()
        val bodies = c.split(Regex("""@Test\b""")).drop(1).map { it.substringBefore("\n    }\n") }
        val reading = bodies.filter { body ->
            // The name in backticks is prose, not code: "the workflow …" does not call a helper `workflow`.
            val t = body.replace(Regex("`[^`\n]*`"), "``")
            // Messages are prose too: "the code reads …" does not call a helper `code`.
            val calls = string.replace(t, "\"\"")
            readsSource.containsMatchIn(t) || helper.any { Regex("""\b${Regex.escape(it)}\b""").containsMatchIn(calls) }
        }.map { Regex("""fun `([^`]*)`""").find(it)?.groupValues?.get(1) ?: "?" }
        return bodies.size to reading
    }

    internal fun sourceTextFunctions(raw: String): Pair<Int, Int> = readingTests(raw).let { (n, r) -> n to r.size }

    @Test
    fun `test functions that read source become fewer, never more`() {
        val FUNCTIONS = 140
        val ONLY_SOURCE_TEXT = 32
        // Every module and build-logic, with device tests and test fixtures: a check that moves does not vanish.
        val all = (Sources.module + File(Sources.project, "build-logic")).flatMap { m ->
            m.walkTopDown().onEnter { it.name != "build" }
                .filter { it.isFile && it.name.endsWith("Test.kt") && it.name != "SourceRatchetTest.kt" }
                .filter { Regex("/src/(test|androidTest|testFixtures)/").containsMatchIn(it.invariantSeparatorsPath) }.toList()
        }
        val tally = all.associate { it.relativeTo(Sources.project).invariantSeparatorsPath to readingTests(it.readText()) }
        val total = tally.values.sumOf { it.first }
        assertTrue("Only ${all.size} test files, $total tests — does the search still apply?", all.size >= 200 && total >= 1000)
        val only = tally.filterValues { (n, l) -> n > 0 && l.size == n }.keys.sorted()
        ratchet("test functions that read source", FUNCTIONS, tally.values.sumOf { it.second.size },
            "If the new test checks behavior, it should run the code instead of looking whether a line is there.")
        ratchet("test files that only read source", ONLY_SOURCE_TEXT, only.size, only.joinToString())
        // Structure (StructureChecks.kt) may read source; a behavior check runs the code. No exception.
        val readers = tally.flatMap { (path, t) -> t.second.map { path.substringAfterLast('/') + ": " + it } }
        val behavior = readers.filter { it.substringBefore(": ") !in structureFiles && it !in structureChecks }
        assertEquals("Behavior checks that read source — run the code instead; structure goes into " +
            "StructureChecks.kt with a reason", emptyList<String>(), behavior)
        val stale = (structureChecks.keys - readers.toSet()) + (structureFiles.keys - readers.map { it.substringBefore(": ") }.toSet())
        assertEquals("Entries in StructureChecks.kt without a reading check", emptySet<String>(), stale)
    }

    @Test
    fun `a reading helper counts for every function that uses it`() {
        val file = "private val src = Sources.read(\"x.kt\")\n" +
            "@Test\nfun a() {\n    assert(\"y\" in src)\n    }\n" +
            "@Test\nfun b() {\n    assert(1 + 1 == 2)\n    }\n"
        assertEquals(2 to 1, sourceTextFunctions(file))
    }

    @Test
    fun `the output of a tool is not source`() {
        val file = "private fun jobRun() = ProcessBuilder(\"python3\").start().inputStream.bufferedReader().readText()\n" +
            "@Test\nfun a() {\n    assert(\"ok\" in jobRun())\n    }\n\n" +
            "@Test\nfun b() {\n    assert(\"x\" in File(\"y\").readText())\n    }\n"
        assertEquals(2 to 1, sourceTextFunctions(file))
    }

    /** The Kotlin files under src/main of all modules, without those generated from the design tokens. */
    private fun productionFiles(): List<File> = Sources.module.flatMap { m ->
        File(m, "src/main").walkTopDown().filter { it.isFile && it.extension == "kt" }.toList()
    }.filterNot { "GENERATED from shared/design-tokens.json" in it.readText() }

    private val counterCheck = Regex("Gegenprobe|Counter-check", RegexOption.IGNORE_CASE)

    private fun isComment(t: String) = t.startsWith("//") || t.startsWith("*") || t.startsWith("/*")

    /** Prose lines per comment block (// sequence of equal indentation or /* … */), without KDoc tags. */
    private fun blocks(rows: List<String>): List<Pair<Int, Int>> {
        val outcome = mutableListOf<Pair<Int, Int>>()
        var i = 0
        while (i < rows.size) {
            val t = rows[i].trim()
            val indent = rows[i].length - rows[i].trimStart().length
            var j = i
            val text = mutableListOf<String>()
            when {
                t.startsWith("//") -> {
                    while (j + 1 < rows.size && rows[j + 1].trim().startsWith("//") &&
                        rows[j + 1].length - rows[j + 1].trimStart().length == indent) j++
                    (i..j).mapTo(text) { rows[it].trim().removePrefix("//").trim() }
                }
                t.startsWith("/*") && !t.contains("*/") -> {
                    while (j + 1 < rows.size && !rows[j].contains("*/")) j++
                    (i..j).mapTo(text) { rows[it].trim().removePrefix("/**").removePrefix("/*").removeSuffix("*/").removePrefix("*").trim() }
                }
                else -> { i++; continue }
            }
            outcome += (i + 1) to prose(text)
            i = j + 1
        }
        return outcome
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
        val BARRIER = 22.7
        var rows = 0
        var comment = 0
        for (f in productionFiles()) for (z in f.readLines()) {
            val t = z.trim()
            if (t.isEmpty()) continue
            rows++
            if (isComment(t)) comment++
        }
        assert(rows > 30_000) { "Only $rows rows found — does the search still apply?" }
        val share = Math.round(1000.0 * comment / rows) / 10.0
        assert(share <= BARRIER) { "comment share $share %, allowed $BARRIER %" }
    }

    @Test
    fun `no comment has more than five lines of prose`() {
        var counted = 0
        val lang = productionFiles().flatMap { f ->
            blocks(f.readLines()).also { counted += it.size }
                .filter { it.second > 5 }.map { "${f.name}:${it.first} (${it.second} lines)" }
        }
        assert(counted > 1000) { "Only $counted comment blocks found — does the search still apply?" }
        assert(lang.isEmpty()) { "Comments over five lines; shorten the why, put the history in the commit:\n  " + lang.joinToString("\n  ") }
    }

    /** Prose lines per `#` block (equal indentation); empty `#` lines do not count. */
    private fun hashesBlocks(rows: List<String>): List<Pair<Int, Int>> {
        val outcome = mutableListOf<Pair<Int, Int>>()
        var i = 0
        while (i < rows.size) {
            val indent = rows[i].length - rows[i].trimStart().length
            if (!rows[i].trimStart().startsWith("#")) { i++; continue }
            var j = i
            while (j + 1 < rows.size && rows[j + 1].trimStart().startsWith("#") &&
                rows[j + 1].length - rows[j + 1].trimStart().length == indent) j++
            outcome += (i + 1) to (i..j).count { rows[it].trim().trimStart('#').isNotBlank() }
            i = j + 1
        }
        return outcome
    }

    /** Build scripts of all modules, build-logic, catalog and gradle.properties. */
    private fun buildFiles(): List<File> =
        Sources.module.map { File(it, "build.gradle.kts") }.filter { it.isFile } +
            listOf("build.gradle.kts", "settings.gradle.kts", "gradle/libs.versions.toml", "gradle.properties")
                .map { File(Sources.project, it) }.filter { it.isFile } +
            File(Sources.project, "build-logic").walkTopDown()
                .filter { it.isFile && (it.extension == "kt" || it.name.endsWith(".gradle.kts")) && "/build/" !in it.invariantSeparatorsPath }

    @Test
    fun `no comment in build files has more than five lines of prose`() {
        var counted = 0
        val lang = buildFiles().flatMap { f ->
            val z = f.readLines()
            val blocks = if (f.extension in setOf("toml", "properties")) hashesBlocks(z) else blocks(z)
            blocks.also { counted += it.size }.filter { it.second > 5 }.map { "${f.name}:${it.first} (${it.second} lines)" }
        }
        assertTrue("Only $counted comment blocks in build files — does the search still apply?", counted > 30)
        assertTrue("Comments over five lines; shorten the why, put the history in the commit:\n  " + lang.joinToString("\n  "),
            lang.isEmpty())
    }

    @Test
    fun `long comments in the workflow and in tests become fewer`() {
        val WORKFLOW = 1
        val TESTS = 42
        val DATE_AND_ID = 0
        val HISTORY = 0
        val wf = File(Sources.project, "../.github/workflows/android.yml").readLines()
        val wfLang = hashesBlocks(wf).filter { it.second > 5 }
        // In tests a paragraph may only be longer if it enumerates the counter-checks.
        val files = Sources.tests.walkTopDown().filter { it.isFile && it.extension == "kt" }.toList()
        val testLang = files.flatMap { f -> longParagraphs(f.readLines()).map { "${f.name}:$it" } }
        val identifier = Regex("""[0-9]{2}\.[0-9]{2}\.20[0-9]{2}|\b(?:arch|sec|ux|perf)[0-9]+\b|\bhardened-[0-9]+""")
        val history = files.flatMap { f ->
            f.readLines().filter { z ->
                val t = z.trim()
                (t.startsWith("//") || t.startsWith("*") || t.startsWith("/*")) &&
                    identifier.containsMatchIn(t) && !counterCheck.containsMatchIn(t)
            }.map { "${f.name}: ${it.trim()}" }
        }
        // Who reported what and in which addendum belongs in the commit, not in the test header.
        val narrative = Regex("""Nachtr[aä]g\w*\s+[0-9]|\bMarcos?\b|Woher dies|\bLauf [0-9]{2,}|CI-Lauf|\bRunde [0-9]+|Addendum\w*\s+[0-9]|\bRun [0-9]{2,}|CI run|\bRound [0-9]+""")
        val tells = files.flatMap { f ->
            f.readLines().filter { z ->
                val t = z.trim()
                (t.startsWith("//") || t.startsWith("*") || t.startsWith("/*")) && narrative.containsMatchIn(t)
            }.map { "${f.name}: ${it.trim()}" }
        }
        assertTrue("Only ${wf.size} workflow lines — path outdated?", wf.size > 500)
        ratchet("workflow comments over five lines", WORKFLOW, wfLang.size, wfLang.joinToString())
        ratchet("paragraphs over five lines in tests without counter-checks", TESTS, testLang.size, testLang.take(20).joinToString())
        ratchet("date or check id in test comments outside the counter-checks", DATE_AND_ID, history.size,
            history.take(20).joinToString("\n  "))
        ratchet("history (addendum, reporter, origin) in test comments", HISTORY, tells.size,
            tells.take(20).joinToString("\n  "))
        // In code and build files a comment names the why, not the check that found it.
        val abbreviation = Regex("""\((?:sec|arch|ux|perf)[0-9]+[^)]*\)|\((?:[HMN][0-9]{1,2})\)|\bNachtrag [0-9]+""")
        val truncated = (productionFiles() + buildFiles()).flatMap { f ->
            f.readLines().filter { z -> z.trim().let { isComment(it) || it.startsWith("#") } && abbreviation.containsMatchIn(z) }
                .map { "${f.name}: ${it.trim()}" }
        }
        ratchet("check abbreviations in comments of code and build", 0, truncated.size, truncated.take(20).joinToString("\n  "))
    }

    /** Line numbers of comment paragraphs over five prose lines that do not begin with „Gegenprobe“ or „Counter-check“. */
    private fun longParagraphs(rows: List<String>): List<Int> {
        val findings = mutableListOf<Int>()
        var begin = -1
        val paragraph = mutableListOf<String>()
        fun close() {
            if (paragraph.size > 5 && !paragraph.first().let { it.startsWith("Gegenprobe") || it.startsWith("Counter-check") }) findings += begin + 1
            paragraph.clear()
        }
        for ((i, z) in rows.withIndex()) {
            val t = z.trim()
            val comment = t.startsWith("//") || t.startsWith("*") || t.startsWith("/*")
            val text = t.removePrefix("/**").removePrefix("/*").removePrefix("//").removeSuffix("*/").removePrefix("*").trim()
            if (!comment || text.isEmpty() || text.startsWith("@")) { close(); continue }
            if (paragraph.isEmpty()) begin = i
            paragraph += text
        }
        close()
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
                    "docs/begruendungen/" in z[i] -> "${f.name}:${i + 1} points to the archive"
                    z[i].trim().startsWith("/**") && i > 0 && z[i - 1].trim().endsWith("*/") -> "${f.name}:${i + 1} second KDoc"
                    else -> null
                }
            }
        }
        assert(kdocs >= 500) { "Only $kdocs KDoc blocks found — does the search still apply?" }
        assert(findings.isEmpty()) { "The why in the comment, the history in the commit:\n  " + findings.joinToString("\n  ") }
    }

    /** Index of the opening bracket for the closing one at [too], -1 if none. */
    private fun openingBracket(c: String, too: Int): Int {
        var depth = 0
        for (i in too downTo 0) {
            if (c[i] == '}') depth++
            if (c[i] == '{' && --depth == 0) return i
        }
        return -1
    }

    private val widerCatch = Regex("""\}\s*catch\s*\(\s*\w+\s*:\s*(?:Exception|Throwable)\s*\)""")
    private val catchClause = Regex("""\}\s*catch\s*\(\s*\w+\s*:\s*([\w.]+)\s*\)$""")

    /** true if the catch has no cancellation branch and its try body contains [call]; null without try. */
    private fun swallowsAbort(c: String, catch: MatchResult, call: Regex): Boolean? {
        var too = catch.range.first
        var abort = false
        var on = openingBracket(c, too)
        var clause = if (on < 0) null else catchClause.find(c.substring(maxOf(0, on - 200), on).trimEnd())
        while (on >= 0 && clause != null) {
            if (clause.groupValues[1].endsWith("CancellationException")) abort = true
            too = c.lastIndexOf('}', on - 1)
            on = openingBracket(c, too)
            clause = if (on < 0) null else catchClause.find(c.substring(maxOf(0, on - 200), on).trimEnd())
        }
        if (on < 0 || !c.substring(0, on).trimEnd().endsWith("try")) return null
        return !abort && call.containsMatchIn(c.substring(on + 1, too))
    }

    /** The app's sources and a pattern for calling one of its suspend functions. */
    private val suspendCalls: Pair<Map<File, String>, Pair<Set<String>, Regex>> by lazy {
        val texts = productionFiles().associateWith { code(it.readText()) }
        val names = texts.values.flatMap { c ->
            Regex("""\bsuspend\s+fun\s+(?:<[^>]*>\s*)?(?:\w+\.)?(\w+)""").findAll(c).map { it.groupValues[1] }.toList()
        }.toSet() + setOf("collect", "withContext", "withLock", "delay", "await", "join", "emit", "first")
        texts to (names to Regex("""\b(?:${names.joinToString("|")})\s*[({]"""))
    }

    /** Parameters and fields with a suspend function type (`source: suspend () -> T`); a name only in their file. */
    private val suspendType = Regex("""\b(\w+)\s*:\s*\(?\s*suspend\b""")

    /** The call pattern for [c]: the app's suspend functions and the file's suspend lambdas. */
    private fun callIn(c: String): Regex {
        val (names, _) = suspendCalls.second
        val all = names + suspendType.findAll(c).map { it.groupValues[1] }
        return Regex("""\b(?:${all.joinToString("|")})\s*[({]""")
    }

    private val coroutinesBlock = Regex("""\b(?:launch|async|runBlocking|withContext\([^()]*\)|coroutineScope|supervisorScope|flow|runTest)\s*(?:\([^()]*\))?\s*$""")

    /** Does the place [ab] run in a suspend function or a coroutine block? Only there is there a cancellation to swallow. */
    private fun inCoroutine(c: String, ab: Int): Boolean {
        val before = c.substring(maxOf(0, ab - 300), ab)
        val instruction = before.substring(maxOf(before.lastIndexOf('{'), before.lastIndexOf('}')) + 1)
        // Also `= valid(runCatching {`: the expression of a suspend fun runs entirely in it.
        if (Regex("""\bsuspend\s+fun\b[^=]*=[^{};]*$""").containsMatchIn(instruction)) return true
        var depth = 0
        for (j in ab - 1 downTo 0) {
            when (c[j]) {
                '}' -> depth++
                '{' -> if (depth > 0) depth-- else {
                    val header = c.substring(maxOf(0, j - 300), j)
                    if (coroutinesBlock.containsMatchIn(header)) return true
                    val fn = header.lastIndexOf("fun ")
                    if (fn >= 0 && !header.substring(fn).contains('{') && !header.substring(fn).contains('}'))
                        return Regex("""\bsuspend\s+(?:\w+\s+)*$""").containsMatchIn(header.substring(0, fn))
                }
            }
        }
        return false
    }

    @Test
    fun `no runCatching swallows the cancellation of a suspending call`() {
        // runCatching also catches the CancellationException like a broad catch; the
        // cancelled caller would keep running. catchUnlessCancelled exists for that.
        val texts = suspendCalls.first
        var checked = 0
        val findings = texts.flatMap { (f, c) ->
            val call = callIn(c)
            Regex("""\brunCatching\s*\{""").findAll(c).mapNotNull { m ->
                checked++
                var depth = 1
                var i = m.range.last + 1
                while (i < c.length && depth > 0) { if (c[i] == '{') depth++ else if (c[i] == '}') depth--; i++ }
                if (inCoroutine(c, m.range.first) && call.containsMatchIn(c.substring(m.range.last + 1, i - 1)))
                    "${f.name}:${c.substring(0, m.range.first).count { it == '\n' } + 1}" else null
            }.toList()
        }
        assert(checked >= 10) { "Only $checked runCatching found — does the search still apply?" }
        assert(findings.isEmpty()) {
            "runCatching around a suspending call; use catchUnlessCancelled:\n  " + findings.joinToString("\n  ")
        }
    }

    @Test
    fun `no broad catch swallows the cancellation of a suspending call`() {
        // A `catch (_: Exception)` around a suspending call also catches the
        // CancellationException; the cancelled caller would keep running. For that there
        // is catchUnlessCancelled or a preceding cancellation branch.
        val (texts, search) = suspendCalls
        val names = search.first
        var checked = 0
        val findings = texts.flatMap { (f, c) ->
            val call = callIn(c)
            widerCatch.findAll(c).mapNotNull { m ->
                val swallows = swallowsAbort(c, m, call) ?: return@mapNotNull null
                checked++
                if (swallows) "${f.name}:${c.substring(0, m.range.first).count { it == '\n' } + 1}" else null
            }.toList()
        }
        assert(names.size > 100 && checked >= 13) { "Only ${names.size} suspend functions, $checked catches — does the search still apply?" }
        assert(findings.isEmpty()) {
            "Broad catch around a suspending call without a cancellation branch; use catchUnlessCancelled:\n  " +
                findings.joinToString("\n  ")
        }
    }

    @Test
    fun `the detekt baseline holds only length, branching and parameter lists and shrinks`() {
        val baseline = File(Sources.project, "config/detekt/baseline.xml").readText()
        val ids = Regex("""<ID>(\w+):""").findAll(baseline).map { it.groupValues[1] }.toList()
        val limit = File(Sources.project, "tools/detekt-limit.txt").readLines()
            .first { it.isNotBlank() && !it.startsWith("#") }.trim().toInt()
        assert("<CurrentIssues>" in baseline) { "No <CurrentIssues> in the baseline — format outdated?" }
        val foreign = ids.filter { it !in setOf("LongMethod", "CyclomaticComplexMethod", "LongParameterList") }.distinct()
        assert(foreign.isEmpty()) { "The baseline hides other rules: $foreign. Fix the finding, do not list it." }
        ratchet("functions in the detekt baseline (tools/detekt-limit.txt)", limit, ids.size,
            "Split a new long or branched function instead of listing it.")
    }

    @Test
    fun `real-time waiting in tests becomes less, never more`() {
        // A test that sleeps is slow and brittle on a busy runner. ViewModel tests
        // run in ticks (PathServer.onTick, test dispatcher); counted is what still waits.
        val SLEEP = 2
        val WAIT = 13
        val files = (Sources.tests.walkTopDown() + Sources.module.asSequence().flatMap { File(it, "src/testFixtures").walkTopDown() })
            .filter { it.isFile && it.extension == "kt" }.toList()
        val texts = files.map { code(it.readText()) }
        val sleep = texts.sumOf { Regex("""\bThread\.sleep\(""").findAll(it).count() }
        val wait = texts.sumOf { Regex("""\bpollUntil\(""").findAll(it).count() }
        assert(files.size > 200) { "Only ${files.size} test files found — does the search still apply?" }
        val hint = "New tests run in ticks: PathServer.onTick() or FakeApi with a test dispatcher."
        ratchet("Thread.sleep in Tests", SLEEP, sleep, hint)
        ratchet("waitUntil in tests", WAIT, wait, hint)
    }

    private val publicDecl = Regex("""^(?:@[\w.:]+(?:\([^)\n]*\))?\s+)*((?:(?:public|internal|private|protected|data|sealed|abstract|open|enum|inline|value|annotation|const|suspend|operator|infix|tailrec|lateinit|fun interface)\s+)*)(?:fun\s+interface|class|interface|object|typealias|fun|val|var)\s""", RegexOption.MULTILINE)

    /** Public top-level declarations in the main code of the [module]. */
    private fun public(module: List<File>, atLeast: Int): Int {
        val files = module.flatMap { m ->
            File(m, "src/main").walkTopDown().filter { it.isFile && it.extension == "kt" }.toList()
        }
        assert(files.size > atLeast) { "Only ${files.size} files in ${module.map { it.name }} — does the search still apply?" }
        return files.sumOf { f ->
            publicDecl.findAll(f.readText()).count { "private" !in it.groupValues[1] && "internal" !in it.groupValues[1] }
        }
    }

    @Test
    fun `the public surface of the data modules does not grow`() {
        // What only the own module needs is internal: every public declaration is
        // interface for all areas. Counted at the top level, across core-data and
        // everything split off from it; otherwise the number would sink spuriously when moving.
        val LIMIT_AREAS = 180
        val other = setOf("core-model", "core-contract", "core-resources", "core-ui", "core-ui-inventory", "core-state", "core-navigation", "core-session",
            "core-testing")
        val module = Sources.module.filter { it.name.startsWith("core-") && it.name !in other }
        assert("core-data" in module.map { it.name }) { "core-data not under ${module.map { it.name }} — does the search still apply?" }
        ratchet("public declarations in ${module.joinToString { it.name }}", LIMIT_AREAS, public(module, 100),
            "What only the module needs becomes internal.")
    }

    @Test
    fun `the public surface of the areas does not grow`() {
        // An area shows the app routes and destinations; what only it needs itself is internal.
        // Much is still public because graphs and UI tests live in app; the certificate dialog
        // in app reuses the login area's QR scanner (CertificateQrScanner).
        val LIMIT_AREAS = 132
        val module = Sources.module.filter { it.name.startsWith("feature-") }
        assert(module.size >= 7) { "Only ${module.size} areas — does the search still apply?" }
        ratchet("public declarations of the areas", LIMIT_AREAS, public(module, 100),
            "What only the area needs becomes internal.")
    }

    /** All Kotlin files under src/main, without comments and strings. */
    private fun mainCode(): List<Pair<File, String>> = Sources.module.map { File(it, "src/main") }.filter { it.isDirectory }
        .flatMap { d -> d.walkTopDown().filter { it.isFile && it.extension == "kt" }.toList() }
        .map { it to code(it.readText()) }

    @Test
    fun `fixed numbers in padding do not increase`() {
        // Spacings have names (ui/theme/Abstaende); a bare `padding(… 14.dp)` keeps to
        // no scale, and two cards side by side are indented differently.
        val LIMIT_AREAS = 45
        // Likewise the spacings between siblings: spacedBy and Spacer.
        val BETWEEN = 40
        val fixed = Regex("""\bpadding\([^()]*?\b\d+(?:\.\d+)?\.dp""")
        val between = Regex("""\bspacedBy\(\d+(?:\.\d+)?\.dp\)|\bSpacer\(Modifier\.(?:height|width)\(\d+(?:\.\d+)?\.dp\)\)""")
        val code = mainCode()
        ratchet("padding with a fixed dp number", LIMIT_AREAS, code.sumOf { (_, text) -> fixed.findAll(text).count() },
            "Take a spacing from Spacing.")
        ratchet("spacedBy and Spacer with a fixed dp number", BETWEEN, code.sumOf { (_, text) -> between.findAll(text).count() },
            "Take a spacing from Spacing.")
    }

    @Test
    fun `no String-format without Locale`() {
        // Without a Locale String.format formats by the device, not by the app's language;
        // stringResource(id, …) or appNumberLocale() name it explicitly.
        val without = Regex("""\bString\.format\(\s*(?!Locale|appNumberLocale|locale\b|java\.util\.Locale)""")
        val places = mainCode().filter { (_, text) -> without.containsMatchIn(text) }.map { it.first.name }
        assertEquals("String.format without Locale in $places", emptyList<String>(), places)
    }

    @Test
    fun `no load result is dropped silently`() {
        // `as? Outcome.Success` turns a failure into null: the page then shows nothing instead of an
        // error. A result goes through `when` (or loadAs/fetched), so its failure reaches the UI state.
        val dropped = Regex("""\bas\?\s*\w*Outcome\.Success\b""")
        assertTrue("The pattern no longer recognizes the old form",
            dropped.containsMatchIn("(source.partsMetrics() as? Outcome.Success)?.let { }"))
        val places = mainCode().flatMap { (f, text) ->
            dropped.findAll(text).map { "${f.name}:${text.substring(0, it.range.first).count { c -> c == '\n' } + 1}" }.toList()
        }
        assertEquals("load error silently discarded (as? Outcome.Success); handle exhaustively with when",
            emptyList<String>(), places)
    }

    /** The arguments of a call up to the matching bracket; [on] points to the opening one. */
    private fun arguments(text: String, on: Int): String {
        var depth = 0
        var i = on
        while (i < text.length) {
            if (text[i] == '(') depth++ else if (text[i] == ')' && --depth == 0) break
            i++
        }
        return text.substring(on, minOf(i + 1, text.length))
    }

    @Test
    fun `no AlertDialog without window name and heading`() {
        // Without paneTitle TalkBack only says „Dialog“ when opening, without heading() the
        // heading navigation does not find the title. Rueckfrage and AddDialog set both.
        val call = Regex("""\bAlertDialog\(""")
        var seen = 0
        val without = mainCode().flatMap { (f, text) ->
            call.findAll(text).mapNotNull { m ->
                seen++
                val args = arguments(text, m.range.last)
                val missing = listOf("paneTitle", "heading()").filter { it !in args }
                val row = text.substring(0, m.range.first).count { it == '\n' } + 1
                if (missing.isEmpty()) null else "${f.name}:$row without ${missing.joinToString()}"
            }.toList()
        }
        assertTrue("Only $seen AlertDialogs found — does the search still apply?", seen >= 8)
        assertEquals("AlertDialogs without window name or heading", emptyList<String>(), without)
    }

    @Test
    fun `every AlertDialog lies on the window surface`() {
        // Material's surfaceContainerHigh stood gray on the dimmed background in light mode;
        // windowSurface() takes surface there (contrast proven by LockedContrastTest).
        val call = Regex("""\bAlertDialog\(""")
        var seen = 0
        val without = mainCode().flatMap { (f, text) ->
            call.findAll(text).mapNotNull { m ->
                seen++
                val row = text.substring(0, m.range.first).count { it == '\n' } + 1
                if ("containerColor = windowSurface()" in arguments(text, m.range.last)) null else "${f.name}:$row"
            }.toList()
        }
        assertTrue("Only $seen AlertDialogs found — does the search still apply?", seen >= 8)
        assertEquals("AlertDialogs without windowSurface()", emptyList<String>(), without)
    }

    /** Call including trailing block: `Row(…) { … }` or `Row { … }`; [on] points to `(` or `{`. */
    private fun callWithBlock(text: String, on: Int): String {
        val args = if (text[on] == '(') arguments(text, on) else ""
        var i = on + args.length
        while (i < text.length && text[i].isWhitespace()) i++
        if (i >= text.length || text[i] != '{') return args
        var depth = 0
        var j = i
        while (j < text.length) {
            if (text[j] == '{') depth++ else if (text[j] == '}' && --depth == 0) break
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
        val main = Regex("""(?<![\w.])(?:Button|FilledTonalButton)\(""")
        var seen = 0
        val own = mainCode().filter { (f, _) -> f.name != "Dialogs.kt" }.flatMap { (f, text) ->
            series.findAll(text).mapNotNull { m ->
                seen++
                val content = callWithBlock(text, m.range.last)
                val row = text.substring(0, m.range.first).count { it == '\n' } + 1
                if ("Text(stringResource(R.string.common_cancel))" in content && main.containsMatchIn(content)) "${f.name}:$row" else null
            }.toList()
        }
        assertTrue("Only $seen rows found — does the search still apply?", seen >= 100)
        assertEquals("own button row with cancel and main button; use the button row",
            emptyList<String>(), own)
    }

    @Test
    fun `the activity no longer holds ViewModels`() {
        // Activity-wide only what lies above every destination (ActivityState) and the mandatory forms;
        // everything else gets its destination with hiltViewModel() at its entry.
        val LIMIT_AREAS = 5
        val activity = Sources.module.map { File(it, "src/main") }.filter { it.isDirectory }
            .flatMap { d -> d.walkTopDown().filter { it.isFile && it.name == "MainActivity.kt" }.toList() }
        assertEquals("exactly one MainActivity", 1, activity.size)
        val number = Regex("""\bby\s+viewModels\s*\(""").findAll(code(activity.single().readText())).count()
        ratchet("ViewModels at the activity", LIMIT_AREAS, number, "A ViewModel belongs to its destination.")
    }

    @Test
    fun `no fully qualified project name in the code`() {
        // An import shows the dependency at the head of the file; inline it stays
        // invisible and the line long. Comments and strings do not count.
        val full = Regex("""(?<![\w.])ch\.brickinventoryapp(?:\.[a-z]\w*)+\.[A-Za-z_]\w*""")
        val files = productionFiles() + Sources.tests.walkTopDown().filter { it.isFile && it.extension == "kt" }
        assert(files.size > 500) { "Only ${files.size} files found — does the search still apply?" }
        val findings = files.flatMap { f ->
            code(f.readText()).lines().map { it.replace(Regex("//.*"), "") }
                .filterNot { it.trimStart().startsWith("import ") || it.trimStart().startsWith("package ") }
                .filter { full.containsMatchIn(it) }.map { "${f.name}: ${it.trim()}" }
        }
        assert(findings.isEmpty()) { "Fully qualified names; import instead of spelling out:\n  " + findings.joinToString("\n  ") }
    }

    @Test
    fun `fully qualified names of foreign packages become fewer`() {
        // Written out only for a real name clash, and then better with `import … as`.
        val MAIN = 156
        val TESTS = 0
        val full = Regex("""(?<![\w.@])(?:androidx|android|kotlinx|kotlin|java|javax|okhttp3|okio|retrofit2|com|org|coil3|dagger)(?:\.[a-z]\w*)+\.[A-Z]\w*""")
        fun count(files: Sequence<File>) = files.sumOf { f ->
            code(f.readText()).lines().map { it.replace(Regex("//.*"), "") }
                .filterNot { it.trimStart().startsWith("import ") || it.trimStart().startsWith("package ") }
                .sumOf { full.findAll(it).count() }
        }
        val main = count(productionFiles().asSequence())
        val tests = count(Sources.tests.walkTopDown().filter { it.isFile && it.extension == "kt" })
        assertTrue("No fully qualified names found — does the pattern still apply?", main + tests > 0)
        ratchet("fully qualified names in main code", MAIN, main)
        ratchet("fully qualified names in tests", TESTS, tests)
    }

    @Test
    fun `screens do not trigger loading via LaunchedEffect, states carry loading and message`() {
        // Target 0: the ViewModel loads itself (init, observeLoadOn); the screen calls
        // at most refresh() in response to a gesture. Counted: LaunchedEffect with a load… call.
        val LOADING = 0
        val effect = Regex("""\bLaunchedEffect\([^)]*\)\s*\{([^{}]*(?:\{[^{}]*\}[^{}]*)*)\}""")
        val loader = Regex("""\b(?:load|load)[A-Z]\w*\s*\(""")
        val findings = productionFiles().flatMap { f ->
            effect.findAll(code(f.readText())).filter { loader.containsMatchIn(it.groupValues[1]) }.map { f.name }.toList()
        }
        assertTrue("No LaunchedEffect found — does the pattern still apply?",
            productionFiles().any { "LaunchedEffect(" in it.readText() })
        ratchet("LaunchedEffects that load", LOADING, findings.size, findings.joinToString())
        // A screen state carries Laden<T> (fetch) or Vorgang (action) instead of a pair
        // of `running: Boolean` and `error: String?`, and Meldung or error class instead of a
        // translated sentence: the sentence arises when drawing, in the language of then.
        val OLD = 0
        val TEXT = 0
        val load = Regex("""(?i)^(loading\w*|load|\w*loading|\w*loading|\w*running|saves|sendet|prueft|\w*ing)$""")
        val text = Regex("""(?i)(error|error|message|message|hint)""")
        val condition = Regex("""data class [A-Za-z0-9_]*(UiState|State)\b""")
        var old = 0
        var states = 0
        var texts = 0
        for ((module, rows) in rowsPerModule()) {
            if (presentation.none { module.startsWith(it) }) continue
            val isState = condition.containsMatchIn(rows.joinToString("\n"))
            if (isState) states++
            for (z in rows) {
                val m = property.find(z) ?: continue
                val (name, type) = m.destructured
                if (type == "Boolean" && load.matches(name)) old++
                if (isState && type != "Boolean" && text.containsMatchIn(name)) texts++
            }
        }
        // Both numbers stand at 0; that the pattern still applies is shown by an old form.
        val unrecognized = listOf("galleryLoading", "stockRunning", "isExporting", "saves", "loadingCheck")
            .filterNot { recognized(load, it) }
        assertTrue("The pattern no longer recognizes $unrecognized", unrecognized.isEmpty())
        assertTrue("Only $states state files — does the search still apply?", states >= 10)
        ratchet("old loading forms (Boolean loading/…running/saves/…ing)", OLD, old,
            "Take Load<T> (model/ui/Load.kt) for fetches, Operation (model/ui/Operation.kt) for actions.")
        ratchet("finished texts in the state (String error/message/…)", TEXT, texts,
            "Store a Message (model/ui/Message.kt) or error class; the screen forms the sentence.")
    }

    @Test
    fun `domain types carry amounts as Money and points in time as Instant, not as Double and String`() {
        // Target 0, both reached: counted are properties in core-model whose name names an amount
        // or a date. Percentages are not amounts.
        val AMOUNTS = 0
        val DATA = 0
        val propertyType = Regex("""\bva[lr]\s+(\w+)\s*:\s*(Double|String)\b""")
        val amount = Regex("""(?i)(price|price|amount|amount|value|threshold|value|kosten)""")
        val share = Regex("""(?i)(percent|pct|frac)""")
        val datum = Regex("""(At|Am|Datum|Date)$|^(datum|date|tag)$""")
        fun count(rows: List<String>): Pair<List<String>, List<String>> {
            val hits = rows.flatMap { z -> propertyType.findAll(z).map { it.groupValues[1] to it.groupValues[2] }.toList() }
            return hits.filter { (n, t) -> t == "Double" && amount.containsMatchIn(n) && !share.containsMatchIn(n) }.map { it.first } to
                hits.filter { (n, t) -> t == "String" && datum.containsMatchIn(n) }.map { it.first }
        }
        val probe = count(listOf("    val avgPrice: Double? = null,", "    val createdAt: String? = null,", "    val pnlPercent: Double? = null,"))
        assertEquals("The pattern no longer recognizes the old forms", listOf("avgPrice") to listOf("createdAt"), probe)
        val (money, days) = count(rowsPerModule().filter { it.first == "core-model" }.flatMap { it.second })
        ratchet("amounts as Double in core-model", AMOUNTS, money.size, "take Money (model/domain/Money.kt): $money")
        ratchet("dates as String in core-model", DATA, days.size, "take Instant, read with parseInstant(): $days")
    }
    /** Whether [pattern] counts a Boolean property of this name as an old loading form. */
    private fun recognized(pattern: Regex, name: String): Boolean =
        property.find("    val $name: Boolean = false,")?.destructured?.component1()?.let(pattern::matches) == true

    /** The main sources of a module, line by line; the rules below read only line starts. */
    private fun rowsPerModule(): List<Pair<String, List<String>>> = Sources.module.flatMap { m ->
        File(m, "src/main/java").walkTopDown().filter { it.isFile && it.extension == "kt" }
            .map { m.name to it.readText().split("\n") }.toList()
    }

    private val property = Regex("""^\s*(?:(?:private|internal|public|override)\s+)*(?:val|var)\s+([A-Za-z_][A-Za-z0-9_]*)\s*:\s*(Boolean|String\?|String)(?![A-Za-z0-9_<?])""")
    private val presentation = listOf("feature-", "core-state", "core-session", "app")

    // ── Language: source code is English ─────────────────────────────────────

    private val commentOrString = Regex("\"\"\"[\\s\\S]*?\"\"\"|\"(?:\\\\.|[^\"\\\\\n])*\"|//[^\n]*|/\\*[\\s\\S]*?\\*/")

    private val germanWords: Set<String> by lazy {
        File(Sources.project, "app/src/test/resources/german-words.txt").readLines()
            .map { it.trim() }.filter { it.isNotEmpty() && !it.startsWith("#") }.toSet()
    }

    /** German endings that English identifiers do not have. */
    private val germanEnding = Regex("""(ungen|ung|keit|heit|schaft|lich)$""")
    private val englishWithGermanEnding = setOf("young", "lung", "sung", "hung", "flung", "rung", "stung", "swung", "strung", "wrung")
    private val umlaut = Regex("[äöüÄÖÜß]")

    private fun nameParts(name: String) = Regex("""[A-Z]+(?![a-z])|[A-Z]?[a-z]+|[äöüÄÖÜß]+\w*""").findAll(name).map { it.value.lowercase() }

    private fun german(name: String): Boolean = umlaut.containsMatchIn(name) || nameParts(name).any { p ->
        p in germanWords || (p.length >= 7 && germanEnding.containsMatchIn(p) && p !in englishWithGermanEnding)
    }

    private val declaration = Regex(
        """\b(?:class|interface|object|fun|val|var|typealias)\s+(?:<[^>]*>\s*)?(?:[A-Za-z_][\w.]*\.)?([A-Za-z_]\w*)""" +
            """|[(,]\s*(?:vararg\s+)?(?:@[\w.]+(?:\([^)]*\))?\s+)*([a-z]\w*)\s*:""")

    private fun declaredNames(code: String) =
        declaration.findAll(code).map { it.groupValues[1].ifEmpty { it.groupValues[2] } } +
            Regex("""\benum\s+class\s+\w+[^{]*\{([^;}]*)""").findAll(code)
                .flatMap { e -> Regex("""(?:^|,)\s*([A-Z][A-Z0-9_]*)""").findAll(e.groupValues[1]).map { it.groupValues[1] } }

    @Test
    fun `file names, declarations and comments are English`() {
        // Kotlin of all modules and of build-logic, main and test.
        val files = (Sources.module + File(Sources.project, "build-logic")).flatMap { m ->
            m.walkTopDown().onEnter { it.name != "build" }.filter { it.isFile && it.extension in setOf("kt", "kts") }.toList()
        }
        assertTrue("Only ${files.size} Kotlin files found — does the search still apply?", files.size > 800)
        // No exception: since API v2 the generated contract (Contract.kt) is English as well.
        val names = files.filter { german(it.nameWithoutExtension) }.map { it.name }
        assertEquals("German file names (Kotlin): $names", emptyList<String>(), names)
        val declared = files.flatMap { f ->
            declaredNames(Sources.strip(f.readText())).filter { german(it) }.map { "${f.name}: $it" }.toList()
        }.distinct()
        assertEquals("German declarations:\n  " + declared.joinToString("\n  "), emptyList<String>(), declared)
        // Comments: German words outside quotes; quoted UI texts and patch names (with hyphens) do not count.
        // A fixed ban, no longer a ratchet: every comment is English.
        val prose = Regex("""(?<![\w-])(der|die|das|und|nicht|wird|werden|auch|noch|wenn|weil|oder|sich)(?![\w-])""")
        val word = Regex("""(?<![\w-])[a-zäöüß]{4,}(?![\w-])""")
        val quoted = Regex("""„[^“\n]*“|"[^"\n]*"|`[^`\n]*`|«[^»\n]*»""")
        val comments = files.sumOf { f ->
            // Strings first, so a `//` inside "https://…" is no comment.
            commentOrString.findAll(f.readText()).filter { !it.value.startsWith("\"") }.sumOf { c ->
                val t = quoted.replace(c.value, "")
                prose.findAll(t).count() + word.findAll(t).count { it.value in germanWords || umlaut.containsMatchIn(it.value) }
            }
        }
        assertEquals("German comment words; comments are English (CLAUDE.md)", 0, comments)
    }

    /** A string literal that opens an assertion call, or the message lambda right after an assert(…) on the same line. */
    private val messageLiteral = Regex(
        """\b(assert(?:True|False|Null|NotNull|Equals|NotEquals|Same|NotSame|That)|fail|error|ratchet)\s*\(\s*""" +
            """("(?:\\.|[^"\\\n])*")""" +
            """|\b(?:assert|check|require|checkNotNull|requireNotNull)\([^\n]*\)\s*\{\s*("(?:\\.|[^"\\\n])*")""")

    /** Top-level arguments of the call whose first argument starts at [from]; a string counts as one. */
    private fun argumentCount(code: String, from: Int): Int {
        var depth = 0
        var commas = 0
        var i = from
        while (i < code.length) {
            val c = code[i]
            when {
                c == '"' -> i = endOfString(code, i)
                c in "([{" -> depth++
                c in ")]}" && depth == 0 -> return commas + 1
                c in ")]}" -> depth--
                c == ',' && depth == 0 -> commas++
            }
            i++
        }
        return commas + 1
    }

    /** Index of the closing quote of the string that opens at [start]. */
    private fun endOfString(code: String, start: Int): Int {
        var i = start + 1
        while (i < code.length && code[i] != '"') i += if (code[i] == '\\') 2 else 1
        return i
    }

    /** The message of an assertion: assertEquals and its kin carry one only as the first of three arguments. */
    private fun messages(code: String): Sequence<String> = messageLiteral.findAll(code).mapNotNull { m ->
        val literal = m.groups[2]
        when {
            m.groupValues[3].isNotEmpty() -> m.groupValues[3]
            literal == null -> null
            m.groupValues[1] in setOf("assertEquals", "assertNotEquals", "assertSame", "assertNotSame", "assertThat") ->
                literal.value.takeIf { argumentCount(code, literal.range.first) >= 3 }
            m.groupValues[1] in setOf("assertTrue", "assertFalse", "assertNull", "assertNotNull") ->
                literal.value.takeIf { argumentCount(code, literal.range.first) >= 2 }
            else -> literal.value
        }
    }

    @Test
    fun `assertion messages are English`() {
        // Test sources of all modules and the shared test helpers; UI texts in quotes do not count.
        val files = (Sources.module + File(Sources.project, "build-logic")).flatMap { m ->
            m.walkTopDown().onEnter { it.name != "build" }
                .filter { it.isFile && it.extension == "kt" && Regex("/src/(test|testFixtures|androidTest)/|core-testing/src/main/")
                    .containsMatchIn(it.invariantSeparatorsPath) }.toList()
        }
        assertTrue("Only ${files.size} test files found — does the search still apply?", files.size > 300)
        val quoted = Regex("""„[^“\n]*“|“[^”\n]*”|`[^`\n]*`|«[^»\n]*»|\$\{[^}]*\}|\$\w+""")
        val prose = Regex("""(?<![\w-])(der|die|das|und|nicht|wird|ist|kein|keine|ohne|mit|nach|fehlt|steht|gefunden)(?![\w-])""")
        val word = Regex("""(?<![\w-])[a-zäöüß]{4,}(?![\w-])""")
        fun germanText(literal: String): Boolean {
            val t = quoted.replace(literal, " ").lowercase()
            return prose.containsMatchIn(t) || word.findAll(t).any { it.value in germanWords || umlaut.containsMatchIn(it.value) }
        }
        val found = files.flatMap { f ->
            messages(Sources.withoutComments(f.readText())).filter { germanText(it) }.map { "${f.name}: $it" }.toList()
        }
        // That the pattern still applies is shown by an old form.
        assertTrue("The pattern no longer recognizes a German message",
            messages("assert" + """True("Die Liste fehlt", ok)""").any { germanText(it) })
        assertTrue("An expected value is no message", messages("""assertEquals("Galerie", title)""").none())
        assertEquals("German assertion messages; tests speak English (CLAUDE.md):\n  " + found.joinToString("\n  "),
            emptyList<String>(), found)
    }
}
