package ch.brickinventoryapp.app

import ch.brickinventoryapp.testing.Sources
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

/**
 * Structure of the Android workflow (structure check): the counter-checks job measures every
 * counter-check against a real test class, and the release path runs with fixed tooling,
 * names the certificate and hands out no installable APK outside of a tag.
 *
 * Counter-checks (patches under counter-checks/):
 *   counter-checks-job-weich     continue-on-error in the job `counter-checks` → red “the counter-checks job …”
 *   release-image-wechselnd   job `signature` (android-signieren.yml) on ubuntu-latest → red “the release path …”
 *   workflow-image-wechselnd  job `counter-checks` on ubuntu-latest → red “the release path …”
 *   (local) in the header of teile-ablage-trotz-konto again `Rot:` followed by a sentence instead of a test name
 *   Antwort des Servers` (a message, not a test name) → red “the counter-checks job …”
 */
class AndroidWorkflowTest {

    private val workflow = Sources.workflow()
    private val signingPath = Sources.workflow("android-signieren.yml")
    private val approval = Sources.workflow("android-release.yml")

    /** The body of a job up to the next job. */
    private fun job(name: String, text: String = workflow): String {
        val part = text.split(Regex("""\n  ${Regex.escape(name)}:\n""")).getOrNull(1)
        assertTrue("job $name missing", part != null)
        return part!!.split(Regex("""\n  [\w-]+:\n""")).first()
    }

    /** The run block of the step with this name. */
    private fun step(name: String, text: String = workflow): String {
        val z = text.lines()
        val i = z.indexOfFirst { it.trim() == "- name: $name" }
        assertTrue("step “$name” missing", i >= 0)
        val r = (i + 1 until z.size).first { Regex("""^\s+run: \|\s*$""").matches(z[it]) }
        val deep = z[r + 1].length - z[r + 1].trimStart().length
        val end = (r + 1 until z.size).firstOrNull { z[it].isNotBlank() && z[it].length - z[it].trimStart().length < deep } ?: z.size
        return z.subList(r + 1, end).joinToString("\n")
    }

    private fun header(patch: File, field: String) =
        Regex("^$field: (.+)$", RegexOption.MULTILINE).find(patch.readText().substringBefore("\ndiff --git "))?.groupValues?.get(1)

    @Test
    fun `the counter-checks job measures every patch counter-check against a real test class`() {
        val j = job("counter-checks")
        assertTrue("the job does not call the tool", "python3 tools/counter-checks.py counter-checks" in j)
        assertFalse("a green counter-check must turn the run red", "continue-on-error" in j)
        val patches = File(Sources.project, "counter-checks").listFiles { f -> f.name.endsWith(".patch") }.orEmpty()
        assertTrue("Only ${patches.size} patches — does the search still apply?", patches.size >= 100)
        val classes = patches.map { p ->
            assertTrue("${p.name}: header without counter-check or red", header(p, "Gegenprobe") != null && header(p, "Rot") != null)
            val full = header(p, "Test").orEmpty()
            val file = File(Sources.project, "${header(p, "Modul")}/src/test/java/${full.replace('.', '/')}.kt")
            assertTrue("${p.name}: $full does not lie in ${header(p, "Modul")}", file.isFile)
            // `counter-checks.py` searches `Rot` in the names of the failed tests, not in their
            // messages; a message text would mean „blieb grün“ although the test was red.
            val names = Regex("""fun `([^`]+)`|fun (\w+)\(""").findAll(file.readText()).map { it.value }.toList()
            assertTrue("${p.name}: red “${header(p, "Rot")}” is not a test name in $full",
                names.any { header(p, "Rot").orEmpty() in it })
            full.substringAfterLast('.')
        }.toSet()
        for (k in listOf("FlowTest", "StockMigrationTest")) assertTrue("$k needs a counter-check", k in classes)
    }

    @Test
    fun `the release path has fixed tooling, a named certificate and no probe APK to install`() {
        val jobs = listOf("build" to workflow, "uebergabe" to workflow, "signatur" to signingPath, "beschreibung" to signingPath,
            "apk-pruefen" to signingPath, "etikett" to approval, "release" to approval)
        for ((j, text) in jobs) assertTrue("$j runs on a changing image", "runs-on: ubuntu-24.04" in job(j, text))
        val all = listOf(workflow, signingPath, approval, Sources.workflow("android-bescheinigung.yml"))
        assertTrue("an Android job runs on ubuntu-latest", all.none { "ubuntu-latest" in it })
        assertFalse("tools “the newest of the image”", all.any { "build-tools/*/" in it })
        val sign = step("Signieren", signingPath)
        assertTrue(Regex("""WERKZEUGE="\${'$'}ANDROID_HOME/build-tools/\d+\.\d+\.\d+"""").containsMatchIn(sign))
        assertTrue("the signing tools are not checked against fixed checksums",
            Regex("""[0-9a-f]{64} "\${'$'}WERKZEUGE/zipalign"[\s\\]+[0-9a-f]{64} "\${'$'}WERKZEUGE/lib/apksigner\.jar"[\s\\]+\| sha256sum -c -""")
                .containsMatchIn(sign))
        val should = File(Sources.project, "tools/release-certificate.sha256").readLines()
            .map { it.substringBefore('#').trim() }.firstOrNull { Regex("^[0-9a-f]{64}$").matches(it) }
        assertTrue("the README does not name the stored certificate",
            should != null && "SHA-256 $should" in File(Sources.project, "README.md").readText())
        val provide = step("BrickInventory.apk als Release bereitstellen", approval)
        for (s in listOf("tools/release-certificate.sha256", "Signierzertifikat SHA-256: \\`\$ZERT\\`", "apksigner verify --print-certs"))
            assertTrue("release step without “$s”", s in provide)
        val pr = workflow.substringAfter("\n  pull_request:\n").substringBefore("\n  workflow_dispatch:")
        assertTrue("pull_request without a workflow path", "- '.github/workflows/android.yml'" in pr && "- '.github/workflows/android-signieren.yml'" in pr)
        assertTrue("an installable APK outside a tag",
            Regex("""if \[ "\${'$'}ECHT" != "true" \]; then\n\s+mv "\${'$'}APK_AUS" "\${'$'}AUS/apk/release/BrickInventory\.apk\.probe-nicht-installieren"""")
                .containsMatchIn(sign))
        assertTrue("BrickInventory.apk.probe-nicht-installieren" in step("Probe-APK für die Prüfung benennen", signingPath))
        assertFalse("pruefsummen-vergleich" in job("pruefsummen"))
        val together = job("pruefsummen-zusammenfassen")
        assertTrue("checksum-compare.py" in together)
        assertEquals("the summary is produced without Gradle", false,
            Regex("gradlew|setup-gradle").containsMatchIn(together))
    }
}
