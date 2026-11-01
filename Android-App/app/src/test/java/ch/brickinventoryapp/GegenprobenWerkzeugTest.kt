package ch.brickinventoryapp

import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File
import java.util.concurrent.TimeUnit

/**
 * Das Werkzeug des CI-Jobs `gegenproben` (tools/gegenproben.py), ausgeführt in
 * einem Wegwerf-Repository mit einem Gradle-Ersatz: Der schreibt einen
 * JUnit-Bericht, rot genau dann, wenn in der Datei „kaputt“ steht.
 *
 * Gegenproben (31.10.2026, gemessen):
 *   A  in miss() `if not rot` gestrichen → rot „eine Gegenprobe, die grün
 *      bleibt, macht den Job rot“
 *   B  einen fehlenden Bericht als rot gezählt (`return True, …`) → rot „ohne
 *      Testbericht zählt nichts als rot“
 *   C  `git apply -R` weggelassen → rot „eine rote Gegenprobe besteht …“
 *      (die Datei bleibt kaputt)
 */
class GegenprobenWerkzeugTest {

    private val wurzel = File(System.getProperty("java.io.tmpdir"), "bim-gegenprobe-${System.nanoTime()}").apply { mkdirs() }
    private val projekt = File(wurzel, "Projekt").apply { mkdirs() }
    private val datei = File(projekt, "quelle.txt")
    private val ordner = File(projekt, "gegenproben").apply { mkdirs() }
    private val gradle = File(wurzel, "gradle-ersatz.sh")

    init {
        datei.writeText("heil\n")
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
    fun zu() { wurzel.deleteRecursively() }

    private fun git(vararg args: String): String {
        val p = ProcessBuilder(listOf("git") + args).directory(wurzel).redirectErrorStream(true).start()
        val text = p.inputStream.bufferedReader().readText()
        check(p.waitFor(30, TimeUnit.SECONDS) && p.exitValue() == 0) { text }
        return text
    }

    /** Eine Gegenprobe, die quelle.txt auf [inhalt] setzt, mit Kopf. */
    private fun probe(name: String, inhalt: String, rot: String? = null) {
        datei.writeText("$inhalt\n")
        val diff = git("diff")
        git("checkout", "--", ".")
        File(ordner, "$name.patch").writeText(
            "Gegenprobe: $name\nModul: core-data\nTest: ch.brickinventoryapp.QuelleTest\n" +
                (rot?.let { "Rot: $it\n" } ?: "") + "\n" + diff)
    }

    private fun lauf(): Pair<Int, String> {
        val pb = ProcessBuilder("python3", File("../tools/gegenproben.py").absolutePath, ordner.path)
            .directory(projekt).redirectErrorStream(true)
        pb.environment()["GEGENPROBE_GRADLE"] = "sh ${gradle.path}"
        pb.environment().remove("GITHUB_STEP_SUMMARY")
        val p = pb.start()
        val text = p.inputStream.bufferedReader().readText()
        check(p.waitFor(60, TimeUnit.SECONDS)) { text }
        return p.exitValue() to text
    }

    @Test
    fun `eine rote Gegenprobe besteht, und danach ist die Quelle wieder heil`() {
        probe("macht-kaputt", "kaputt", rot = "ist heil")
        val (code, text) = lauf()
        assertEquals(text, 0, code)
        assertTrue(text, text.contains("rot macht-kaputt.patch"))
        assertEquals("heil\n", datei.readText())
    }

    @Test
    fun `eine Gegenprobe, die gruen bleibt, macht den Job rot`() {
        probe("harmlos", "harmlos")
        val (code, text) = lauf()
        assertEquals(text, 1, code)
        assertTrue(text, text.contains("blieb grün"))
        assertTrue(text, text.contains("::error title=Gegenprobe greift nicht::"))
    }

    @Test
    fun `ohne Testbericht zaehlt nichts als rot`() {
        probe("bricht-bau", "unuebersetzbar")
        val (code, text) = lauf()
        assertEquals(text, 1, code)
        assertTrue(text, text.contains("kein Testbericht"))
        assertEquals("heil\n", datei.readText())
    }

    @Test
    fun `der genannte Test muss der rote sein`() {
        probe("falscher-test", "kaputt", rot = "anderes")
        val (code, text) = lauf()
        assertEquals(text, 1, code)
        assertTrue(text, text.contains("„anderes“ blieb grün"))
    }

    @Test
    fun `ein veralteter Patch und ein leerer Ordner sind Fehler, kein Erfolg`() {
        assertEquals(1, lauf().first)
        probe("veraltet", "kaputt")
        datei.writeText("geaendert\n")
        val (code, text) = lauf()
        assertEquals(text, 1, code)
        assertTrue(text, text.contains("passt nicht mehr"))
    }
}
