package ch.brickinventoryapp.app

import ch.brickinventoryapp.testing.Quellen
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
 * Counter-checks (patches under gegenproben/):
 *   gegenproben-job-weich     continue-on-error in the job `gegenproben` → red “the counter-checks job …”
 *   release-image-wechselnd   job `signatur` (android-signieren.yml) on ubuntu-latest → red “the release path …”
 *   workflow-image-wechselnd  job `gegenproben` on ubuntu-latest → red “the release path …”
 *   (local) in the header of teile-ablage-trotz-konto again `Rot: mit Kontofilter gilt die
 *   Antwort des Servers` (a message, not a test name) → red “the counter-checks job …”
 */
class AndroidWorkflowTest {

    private val workflow = Quellen.workflow()
    private val signierweg = Quellen.workflow("android-signieren.yml")
    private val freigabe = Quellen.workflow("android-release.yml")

    /** The body of a job up to the next job. */
    private fun job(name: String, text: String = workflow): String {
        val teil = text.split(Regex("""\n  ${Regex.escape(name)}:\n""")).getOrNull(1)
        assertTrue("Job $name fehlt", teil != null)
        return teil!!.split(Regex("""\n  [\w-]+:\n""")).first()
    }

    /** The run block of the step with this name. */
    private fun schritt(name: String, text: String = workflow): String {
        val z = text.lines()
        val i = z.indexOfFirst { it.trim() == "- name: $name" }
        assertTrue("Schritt „$name“ fehlt", i >= 0)
        val r = (i + 1 until z.size).first { Regex("""^\s+run: \|\s*$""").matches(z[it]) }
        val deep = z[r + 1].length - z[r + 1].trimStart().length
        val ende = (r + 1 until z.size).firstOrNull { z[it].isNotBlank() && z[it].length - z[it].trimStart().length < deep } ?: z.size
        return z.subList(r + 1, ende).joinToString("\n")
    }

    private fun kopf(patch: File, feld: String) =
        Regex("^$feld: (.+)$", RegexOption.MULTILINE).find(patch.readText().substringBefore("\ndiff --git "))?.groupValues?.get(1)

    @Test
    fun `the counter-checks job measures every patch counter-check against a real test class`() {
        val j = job("gegenproben")
        assertTrue("der Job ruft das Werkzeug nicht", "python3 tools/gegenproben.py gegenproben" in j)
        assertFalse("eine grüne Gegenprobe muss den Lauf rot machen", "continue-on-error" in j)
        val patches = File(Quellen.project, "gegenproben").listFiles { f -> f.name.endsWith(".patch") }.orEmpty()
        assertTrue("Nur ${patches.size} Patches — greift die Suche noch?", patches.size >= 100)
        val classes = patches.map { p ->
            assertTrue("${p.name}: Kopf ohne Gegenprobe oder Rot", kopf(p, "Gegenprobe") != null && kopf(p, "Rot") != null)
            val voll = kopf(p, "Test").orEmpty()
            val datei = File(Quellen.project, "${kopf(p, "Modul")}/src/test/java/${voll.replace('.', '/')}.kt")
            assertTrue("${p.name}: $voll liegt nicht in ${kopf(p, "Modul")}", datei.isFile)
            // gegenproben.py searches `Rot` in the names of the failed tests, not in their
            // messages; a message text would mean „blieb grün“ although the test was red.
            val namen = Regex("""fun `([^`]+)`|fun (\w+)\(""").findAll(datei.readText()).map { it.value }.toList()
            assertTrue("${p.name}: Rot „${kopf(p, "Rot")}“ ist kein Testname in $voll",
                namen.any { kopf(p, "Rot").orEmpty() in it })
            voll.substringAfterLast('.')
        }.toSet()
        for (k in listOf("AblaufTest", "BestandMigrationTest")) assertTrue("$k braucht eine Gegenprobe", k in classes)
    }

    @Test
    fun `the release path has fixed tooling, a named certificate and no probe APK to install`() {
        val jobs = listOf("build" to workflow, "uebergabe" to workflow, "signatur" to signierweg, "beschreibung" to signierweg,
            "apk-pruefen" to signierweg, "etikett" to freigabe, "release" to freigabe)
        for ((j, text) in jobs) assertTrue("$j läuft auf einem wechselnden Image", "runs-on: ubuntu-24.04" in job(j, text))
        val alle = listOf(workflow, signierweg, freigabe, Quellen.workflow("android-bescheinigung.yml"))
        assertTrue("Ein Android-Job läuft auf ubuntu-latest", alle.none { "ubuntu-latest" in it })
        assertFalse("Werkzeuge „das neueste des Images“", alle.any { "build-tools/*/" in it })
        val signieren = schritt("Signieren", signierweg)
        assertTrue(Regex("""WERKZEUGE="\${'$'}ANDROID_HOME/build-tools/\d+\.\d+\.\d+"""").containsMatchIn(signieren))
        assertTrue("die Signierwerkzeuge werden nicht gegen feste Prüfsummen geprüft",
            Regex("""[0-9a-f]{64} "\${'$'}WERKZEUGE/zipalign"[\s\\]+[0-9a-f]{64} "\${'$'}WERKZEUGE/lib/apksigner\.jar"[\s\\]+\| sha256sum -c -""")
                .containsMatchIn(signieren))
        val soll = File(Quellen.project, "tools/release-certificate.sha256").readLines()
            .map { it.substringBefore('#').trim() }.firstOrNull { Regex("^[0-9a-f]{64}$").matches(it) }
        assertTrue("Die README nennt nicht das hinterlegte Zertifikat",
            soll != null && "SHA-256 $soll" in File(Quellen.project, "README.md").readText())
        val bereitstellen = schritt("BrickInventory.apk als Release bereitstellen", freigabe)
        for (s in listOf("tools/release-certificate.sha256", "Signierzertifikat SHA-256: \\`\$ZERT\\`", "apksigner verify --print-certs"))
            assertTrue("Release-Schritt ohne „$s“", s in bereitstellen)
        val pr = workflow.substringAfter("\n  pull_request:\n").substringBefore("\n  workflow_dispatch:")
        assertTrue("pull_request ohne Workflow-Pfad", "- '.github/workflows/android.yml'" in pr && "- '.github/workflows/android-signieren.yml'" in pr)
        assertTrue("ausserhalb eines Etiketts ein installierbares APK",
            Regex("""if \[ "\${'$'}ECHT" != "true" \]; then\n\s+mv "\${'$'}APK_AUS" "\${'$'}AUS/apk/release/BrickInventory\.apk\.probe-nicht-installieren"""")
                .containsMatchIn(signieren))
        assertTrue("BrickInventory.apk.probe-nicht-installieren" in schritt("Probe-APK für die Prüfung benennen", signierweg))
        assertFalse("pruefsummen-vergleich" in job("pruefsummen"))
        val zusammen = job("pruefsummen-zusammenfassen")
        assertTrue("checksum-compare.py" in zusammen)
        assertEquals("die Zusammenfassung entsteht ohne Gradle", false,
            Regex("gradlew|setup-gradle").containsMatchIn(zusammen))
    }
}
