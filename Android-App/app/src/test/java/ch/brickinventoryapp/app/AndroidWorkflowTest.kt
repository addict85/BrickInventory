package ch.brickinventoryapp.app

import ch.brickinventoryapp.testing.Quellen
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

/**
 * Aufbau des Android-Workflows (Strukturprüfung): Der Gegenproben-Job misst jede
 * Gegenprobe gegen eine echte Testklasse, und der Release-Weg läuft mit festem Werkzeug,
 * nennt das Zertifikat und gibt ausserhalb eines Etiketts kein installierbares APK heraus.
 *
 * Gegenproben (Patches unter gegenproben/):
 *   gegenproben-job-weich     continue-on-error im Job `gegenproben` → rot „der Gegenproben-Job …“
 *   release-image-wechselnd   `signieren` auf ubuntu-latest → rot „der Release-Weg …“
 */
class AndroidWorkflowTest {

    private val workflow = Quellen.workflow()

    /** Der Rumpf eines Jobs bis zum nächsten Job. */
    private fun job(name: String): String {
        val teil = workflow.split(Regex("""\n  ${Regex.escape(name)}:\n""")).getOrNull(1)
        assertTrue("Job $name fehlt", teil != null)
        return teil!!.split(Regex("""\n  [\w-]+:\n""")).first()
    }

    /** Der run-Block des Schritts mit diesem Namen. */
    private fun schritt(name: String): String {
        val z = workflow.lines()
        val i = z.indexOfFirst { it.trim() == "- name: $name" }
        assertTrue("Schritt „$name“ fehlt", i >= 0)
        val r = (i + 1 until z.size).first { Regex("""^\s+run: \|\s*$""").matches(z[it]) }
        val tief = z[r + 1].length - z[r + 1].trimStart().length
        val ende = (r + 1 until z.size).firstOrNull { z[it].isNotBlank() && z[it].length - z[it].trimStart().length < tief } ?: z.size
        return z.subList(r + 1, ende).joinToString("\n")
    }

    private fun kopf(patch: File, feld: String) =
        Regex("^$feld: (.+)$", RegexOption.MULTILINE).find(patch.readText().substringBefore("\ndiff --git "))?.groupValues?.get(1)

    @Test
    fun `der Gegenproben-Job misst jede Patch-Gegenprobe gegen eine echte Testklasse`() {
        val j = job("gegenproben")
        assertTrue("der Job ruft das Werkzeug nicht", "python3 tools/gegenproben.py gegenproben" in j)
        assertFalse("eine grüne Gegenprobe muss den Lauf rot machen", "continue-on-error" in j)
        val patches = File(Quellen.projekt, "gegenproben").listFiles { f -> f.name.endsWith(".patch") }.orEmpty()
        assertTrue("Nur ${patches.size} Patches — greift die Suche noch?", patches.size >= 100)
        val klassen = patches.map { p ->
            assertTrue("${p.name}: Kopf ohne Gegenprobe oder Rot", kopf(p, "Gegenprobe") != null && kopf(p, "Rot") != null)
            val voll = kopf(p, "Test").orEmpty()
            val datei = File(Quellen.projekt, "${kopf(p, "Modul")}/src/test/java/${voll.replace('.', '/')}.kt")
            assertTrue("${p.name}: $voll liegt nicht in ${kopf(p, "Modul")}", datei.isFile)
            voll.substringAfterLast('.')
        }.toSet()
        for (k in listOf("AblaufTest", "BestandMigrationTest")) assertTrue("$k braucht eine Gegenprobe", k in klassen)
    }

    @Test
    fun `der Release-Weg hat festes Werkzeug, ein genanntes Zertifikat und kein Probe-APK zum Installieren`() {
        for (j in listOf("build", "signieren", "apk-pruefen", "release"))
            assertTrue("$j läuft auf einem wechselnden Image", "runs-on: ubuntu-24.04" in job(j))
        assertFalse("Werkzeuge „das neueste des Images“", "build-tools/*/" in workflow)
        val signieren = schritt("Signieren")
        assertTrue(Regex("""WERKZEUGE="\${'$'}ANDROID_HOME/build-tools/\d+\.\d+\.\d+"""").containsMatchIn(signieren))
        assertTrue("die Signierwerkzeuge werden nicht gegen feste Prüfsummen geprüft",
            Regex("""[0-9a-f]{64} "\${'$'}WERKZEUGE/zipalign"[\s\\]+[0-9a-f]{64} "\${'$'}WERKZEUGE/lib/apksigner\.jar"[\s\\]+\| sha256sum -c -""")
                .containsMatchIn(signieren))
        val soll = File(Quellen.projekt, "tools/release-zertifikat.sha256").readLines()
            .map { it.substringBefore('#').trim() }.firstOrNull { Regex("^[0-9a-f]{64}$").matches(it) }
        assertTrue("Die README nennt nicht das hinterlegte Zertifikat",
            soll != null && "SHA-256 $soll" in File(Quellen.projekt, "README.md").readText())
        val bereitstellen = schritt("BrickInventory.apk als Release bereitstellen")
        for (s in listOf("tools/release-zertifikat.sha256", "Signierzertifikat SHA-256: \\`\$ZERT\\`", "apksigner verify --print-certs"))
            assertTrue("Release-Schritt ohne „$s“", s in bereitstellen)
        val pr = workflow.substringAfter("\n  pull_request:\n").substringBefore("\n  workflow_dispatch:")
        assertTrue("pull_request ohne Workflow-Pfad", "- '.github/workflows/android.yml'" in pr)
        assertTrue("ausserhalb eines Etiketts ein installierbares APK",
            Regex("""if \[ "\${'$'}ECHT" != "true" \]; then\n\s+mv "\${'$'}APK_AUS" "\${'$'}AUS/apk/release/BrickInventory\.apk\.probe-nicht-installieren"""")
                .containsMatchIn(signieren))
        assertTrue("BrickInventory.apk.probe-nicht-installieren" in schritt("Probe-APK für die Prüfung benennen"))
        assertFalse("pruefsummen-vergleich" in job("pruefsummen"))
        val zusammen = job("pruefsummen-zusammenfassen")
        assertTrue("pruefsummen-vergleich.py" in zusammen)
        assertEquals("die Zusammenfassung entsteht ohne Gradle", false,
            Regex("gradlew|setup-gradle").containsMatchIn(zusammen))
    }
}
