package ch.brickinventoryapp.app

import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File
import java.util.concurrent.TimeUnit

/**
 * The tool of the CI job `counter-checks` (`tools/counter-checks.py`), executed in
 * a throwaway repository with a Gradle stand-in: it writes a
 * JUnit report, red exactly when the file contains „kaputt“.
 *
 * Counter-checks:
 *   A  in miss() `if not red` deleted → red “a counter-check that stays
 *      green makes the job red”
 *   B  a missing report counted as red (`return True, …`) → red “without
 *      a test report nothing counts as red”
 *   C  `git apply -R` omitted → red “a red counter-check passes …”
 *      (the file stays broken)
 *   D  in affected() always all patches returned → red “on a push it measures
 *      only …” (harmlos-anderswo stayed green) and “without an affected patch …” (exit 1)
 *   E  `return 0` for an empty selection deleted → red “without an affected patch …”
 *   F  the emptiness check again after the split into parts → red “on a push it
 *      measures only …” (part 2/2 returns 1, „Keine Gegenproben unter …“)
 *   G  in check() `git apply --check` skipped → red “the check mode …” (exit 0 for the
 *      outdated patch); the test-class lookup dropped → red, the same test (exit 0 for
 *      `Test: …FehltTest`)
 */
class CounterChecksToolTest {

    private val root = File(System.getProperty("java.io.tmpdir"), "bim-gegenprobe-${System.nanoTime()}").apply { mkdirs() }
    private val project = File(root, "Projekt").apply { mkdirs() }
    private val file = File(project, "quelle.txt")
    private val folder = File(project, "counter-checks").apply { mkdirs() }
    private val gradle = File(root, "gradle-ersatz.sh")

    init {
        file.writeText("heil\n")
        File(project, "core-data/src/test/java/ch/brickinventoryapp").apply { mkdirs() }
            .resolve("QuelleTest.kt").writeText("class QuelleTest\n")
        gradle.writeText("""
            modul=${'$'}{1#:}; modul=${'$'}{modul%%:*}; klasse=${'$'}4
            grep -q unuebersetzbar quelle.txt && { echo "e: Übersetzungsfehler"; exit 1; }
            mkdir -p "${'$'}modul/build/test-results/testDebugUnitTest"
            fehler=""; grep -q kaputt quelle.txt && fehler="<failure message='rot'/>"
            printf '<testsuite><testcase name="die Quelle ist heil">%s</testcase><testcase name="anderes"/></testsuite>' "${'$'}fehler" \
              > "${'$'}modul/build/test-results/testDebugUnitTest/TEST-${'$'}klasse.xml"
            [ -z "${'$'}fehler" ]
        """.trimIndent())
        git("init", "-q")
        git("add", ".")
        git("-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "anfang")
    }

    @After
    fun tearDown() { root.deleteRecursively() }

    private fun git(vararg args: String): String {
        val p = ProcessBuilder(listOf("git") + args).directory(root).redirectErrorStream(true).start()
        val text = p.inputStream.bufferedReader().readText()
        check(p.waitFor(30, TimeUnit.SECONDS) && p.exitValue() == 0) { text }
        return text
    }

    /** A counter-check that sets [target] to [content], with header. */
    private fun probe(name: String, content: String, red: String? = null, target: File = file, test: String = "QuelleTest") {
        target.writeText("$content\n")
        val diff = git("diff")
        git("checkout", "--", ".")
        File(folder, "$name.patch").writeText(
            "Gegenprobe: $name\nModul: core-data\nTest: ch.brickinventoryapp.$test\n" +
                (red?.let { "Rot: $it\n" } ?: "") + "\n" + diff)
    }

    private fun jobRun(basis: String? = null, part: String? = null, mode: String? = null): Pair<Int, String> {
        val pb = ProcessBuilder(listOfNotNull("python3", File("../tools/counter-checks.py").absolutePath, mode, folder.path))
            .directory(project).redirectErrorStream(true)
        pb.environment()["COUNTER_CHECK_GRADLE"] = "sh ${gradle.path}"
        if (basis != null) pb.environment()["COUNTER_CHECK_BASIS"] = basis else pb.environment().remove("COUNTER_CHECK_BASIS")
        pb.environment().remove("GITHUB_STEP_SUMMARY")
        pb.environment().remove("COUNTER_CHECK_RESULTS")
        if (part != null) pb.environment()["COUNTER_CHECK_TEIL"] = part else pb.environment().remove("COUNTER_CHECK_TEIL")
        val p = pb.start()
        val text = p.inputStream.bufferedReader().readText()
        check(p.waitFor(60, TimeUnit.SECONDS)) { text }
        return p.exitValue() to text
    }

    @Test
    fun `a red counter-check passes, and afterwards the source is intact again`() {
        probe("macht-kaputt", "kaputt", red = "ist heil")
        val (code, text) = jobRun()
        assertEquals(text, 0, code)
        assertTrue(text, text.contains("rot macht-kaputt.patch"))
        assertEquals("heil\n", file.readText())
    }

    @Test
    fun `a counter-check that stays green makes the job red`() {
        probe("harmlos", "harmlos")
        val (code, text) = jobRun()
        assertEquals(text, 1, code)
        assertTrue(text, text.contains("blieb grün"))
        assertTrue(text, text.contains("::error title=Gegenprobe greift nicht::"))
    }

    @Test
    fun `without a test report nothing counts as red`() {
        probe("bricht-bau", "unuebersetzbar")
        val (code, text) = jobRun()
        assertEquals(text, 1, code)
        assertTrue(text, text.contains("kein Testbericht"))
        assertEquals("heil\n", file.readText())
    }

    @Test
    fun `the named test must be the red one`() {
        probe("falscher-test", "kaputt", red = "anderes")
        val (code, text) = jobRun()
        assertEquals(text, 1, code)
        assertTrue(text, text.contains("„anderes“ blieb grün"))
    }

    @Test
    fun `on a push it measures only the patches whose target changed`() {
        val other = File(project, "andere.txt").apply { writeText("still\n") }
        git("add", ".")
        git("-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "andere")
        val basis = git("rev-parse", "HEAD").trim()
        file.writeText("heil\nnoch heil\n")
        git("-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qam", "quelle")
        probe("macht-kaputt", "kaputt", red = "ist heil")
        probe("harmlos-anderswo", "laut", target = other)
        val (code, text) = jobRun(basis)
        assertEquals(text, 0, code)
        assertTrue(text, text.contains("1 von 2 Gegenproben betroffen") && text.contains("rot macht-kaputt.patch"))
        assertTrue(text, !text.contains("harmlos-anderswo"))
        // Fewer affected patches than parts: the empty part is green, not „keine Gegenproben“.
        val (empty, without) = jobRun(basis, part = "2/2")
        assertEquals(without, 0, empty)
        assertTrue(without, without.contains("Teil 2/2"))
    }

    @Test
    fun `without an affected patch the run is green, without a base it measures all`() {
        probe("harmlos", "harmlos")
        val header = git("rev-parse", "HEAD").trim()
        val (code, text) = jobRun(header)
        assertEquals(text, 0, code)
        assertTrue(text, text.contains("Keine der 1 Gegenproben"))
        val (unknown, all) = jobRun("0000000000000000000000000000000000000000")
        assertEquals(all, 1, unknown)
        assertTrue(all, all.contains("blieb grün"))
    }

    @Test
    fun `an outdated patch and an empty folder are errors, not success`() {
        assertEquals(1, jobRun().first)
        probe("veraltet", "kaputt")
        file.writeText("geaendert\n")
        val (code, text) = jobRun()
        assertEquals(text, 1, code)
        assertTrue(text, text.contains("passt nicht mehr"))
    }

    @Test
    fun `the check mode needs no Gradle and names every patch that no longer fits`() {
        probe("macht-kaputt", "kaputt", red = "ist heil")
        val (code, text) = jobRun(mode = "--check")
        assertEquals(text, 0, code)
        assertTrue(text, text.contains("1 von 1 Gegenproben passen"))
        assertTrue("Gradle ran", !File(project, "core-data/build").exists())
        probe("falsche-klasse", "kaputt", test = "FehltTest")
        val (missing, why) = jobRun(mode = "--check")
        assertEquals(why, 1, missing)
        assertTrue(why, why.contains("FehltTest"))
        File(folder, "falsche-klasse.patch").delete()
        file.writeText("geaendert\n")
        val (stale, reason) = jobRun(mode = "--check")
        assertEquals(reason, 1, stale)
        assertTrue(reason, reason.contains("passt nicht mehr") && reason.contains("0 von 1"))
    }
}
