package ch.brickinventoryapp.app

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
 * Gegenproben:
 *   A  in miss() `if not rot` gestrichen → rot „eine Gegenprobe, die grün
 *      bleibt, macht den Job rot“
 *   B  einen fehlenden Bericht als rot gezählt (`return True, …`) → rot „ohne
 *      Testbericht zählt nichts als rot“
 *   C  `git apply -R` weggelassen → rot „eine rote Gegenprobe besteht …“
 *      (die Datei bleibt kaputt)
 *   D  in betroffen() immer alle Patches zurückgegeben → rot „auf einem Push misst
 *      es nur …“ (harmlos-anderswo blieb grün) und „ohne betroffenen Patch …“ (Rückgabe 1)
 *   E  `return 0` bei leerer Auswahl gestrichen → rot „ohne betroffenen Patch …“
 *   F  die Leer-Prüfung wieder hinter die Aufteilung auf Teile → rot „auf einem Push
 *      misst es nur …“ (Teil 2/2 gibt 1 zurück, „Keine Gegenproben unter …“)
 */
class CounterChecksToolTest {

    private val root = File(System.getProperty("java.io.tmpdir"), "bim-gegenprobe-${System.nanoTime()}").apply { mkdirs() }
    private val project = File(root, "Projekt").apply { mkdirs() }
    private val datei = File(project, "quelle.txt")
    private val folder = File(project, "gegenproben").apply { mkdirs() }
    private val gradle = File(root, "gradle-ersatz.sh")

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
    fun zu() { root.deleteRecursively() }

    private fun git(vararg args: String): String {
        val p = ProcessBuilder(listOf("git") + args).directory(root).redirectErrorStream(true).start()
        val text = p.inputStream.bufferedReader().readText()
        check(p.waitFor(30, TimeUnit.SECONDS) && p.exitValue() == 0) { text }
        return text
    }

    /** Eine Gegenprobe, die [ziel] auf [inhalt] setzt, mit Kopf. */
    private fun probe(name: String, inhalt: String, rot: String? = null, ziel: File = datei) {
        ziel.writeText("$inhalt\n")
        val diff = git("diff")
        git("checkout", "--", ".")
        File(folder, "$name.patch").writeText(
            "Gegenprobe: $name\nModul: core-data\nTest: ch.brickinventoryapp.QuelleTest\n" +
                (rot?.let { "Rot: $it\n" } ?: "") + "\n" + diff)
    }

    private fun lauf(basis: String? = null, teil: String? = null): Pair<Int, String> {
        val pb = ProcessBuilder("python3", File("../tools/gegenproben.py").absolutePath, folder.path)
            .directory(project).redirectErrorStream(true)
        pb.environment()["GEGENPROBE_GRADLE"] = "sh ${gradle.path}"
        if (basis != null) pb.environment()["GEGENPROBE_BASIS"] = basis else pb.environment().remove("GEGENPROBE_BASIS")
        pb.environment().remove("GITHUB_STEP_SUMMARY")
        if (teil != null) pb.environment()["GEGENPROBE_TEIL"] = teil else pb.environment().remove("GEGENPROBE_TEIL")
        val p = pb.start()
        val text = p.inputStream.bufferedReader().readText()
        check(p.waitFor(60, TimeUnit.SECONDS)) { text }
        return p.exitValue() to text
    }

    @Test
    fun `a red counter-check passes, and afterwards the source is intact again`() {
        probe("macht-kaputt", "kaputt", rot = "ist heil")
        val (code, text) = lauf()
        assertEquals(text, 0, code)
        assertTrue(text, text.contains("rot macht-kaputt.patch"))
        assertEquals("heil\n", datei.readText())
    }

    @Test
    fun `a counter-check that stays green makes the job red`() {
        probe("harmlos", "harmlos")
        val (code, text) = lauf()
        assertEquals(text, 1, code)
        assertTrue(text, text.contains("blieb grün"))
        assertTrue(text, text.contains("::error title=Gegenprobe greift nicht::"))
    }

    @Test
    fun `without a test report nothing counts as red`() {
        probe("bricht-bau", "unuebersetzbar")
        val (code, text) = lauf()
        assertEquals(text, 1, code)
        assertTrue(text, text.contains("kein Testbericht"))
        assertEquals("heil\n", datei.readText())
    }

    @Test
    fun `the named test must be the red one`() {
        probe("falscher-test", "kaputt", rot = "anderes")
        val (code, text) = lauf()
        assertEquals(text, 1, code)
        assertTrue(text, text.contains("„anderes“ blieb grün"))
    }

    @Test
    fun `on a push it measures only the patches whose target changed`() {
        val andere = File(project, "andere.txt").apply { writeText("still\n") }
        git("add", ".")
        git("-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "andere")
        val basis = git("rev-parse", "HEAD").trim()
        datei.writeText("heil\nnoch heil\n")
        git("-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qam", "quelle")
        probe("macht-kaputt", "kaputt", rot = "ist heil")
        probe("harmlos-anderswo", "laut", ziel = andere)
        val (code, text) = lauf(basis)
        assertEquals(text, 0, code)
        assertTrue(text, text.contains("1 von 2 Gegenproben betroffen") && text.contains("rot macht-kaputt.patch"))
        assertTrue(text, !text.contains("harmlos-anderswo"))
        // Weniger betroffene Patches als Teile: Der leere Teil ist grün, nicht „keine Gegenproben“.
        val (leer, ohne) = lauf(basis, teil = "2/2")
        assertEquals(ohne, 0, leer)
        assertTrue(ohne, ohne.contains("Teil 2/2"))
    }

    @Test
    fun `without an affected patch the run is green, without a base it measures all`() {
        probe("harmlos", "harmlos")
        val kopf = git("rev-parse", "HEAD").trim()
        val (code, text) = lauf(kopf)
        assertEquals(text, 0, code)
        assertTrue(text, text.contains("Keine der 1 Gegenproben"))
        val (unbekannt, alle) = lauf("0000000000000000000000000000000000000000")
        assertEquals(alle, 1, unbekannt)
        assertTrue(alle, alle.contains("blieb grün"))
    }

    @Test
    fun `an outdated patch and an empty folder are errors, not success`() {
        assertEquals(1, lauf().first)
        probe("veraltet", "kaputt")
        datei.writeText("geaendert\n")
        val (code, text) = lauf()
        assertEquals(text, 1, code)
        assertTrue(text, text.contains("passt nicht mehr"))
    }
}
