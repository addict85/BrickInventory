package ch.brickinventoryapp.app

import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File
import java.util.concurrent.TimeUnit

/**
 * The summary of the checksums job (`tools/checksum-compare.py`),
 * executed against two small metadata files: one new, one removed and one
 * component with a different checksum at the same version.
 *
 * Counter-checks: in vergleiche() `sa != sn` replaced by `False`
 * → red “a changed checksum with the same version stands out”;
 * neu_k and weg_k swapped → red “new and removed components …”.
 * in vertrauen_markdown() `dazu = []` → red “a newly
 * trusted key …”; sorting without `not` (regex last) → red as well.
 * In markdown() `neue_gruppen = []` (measured locally with python3) → red “a new group
 * stands open …”.
 */
class ChecksumsComparisonTest {

    private fun metadata(vararg components: Triple<String, String, String>): File =
        File.createTempFile("pruefsummen", ".xml").apply {
            deleteOnExit()
            writeText("""<?xml version="1.0" encoding="UTF-8"?>
<verification-metadata xmlns="https://schema.gradle.org/dependency-verification"><components>
""" + components.joinToString("\n") { (group, version, sha) ->
                """<component group="$group" name="x" version="$version"><artifact name="x-$version.jar"><sha256 value="$sha"/></artifact></component>"""
            } + "\n</components></verification-metadata>")
        }

    private fun compare(old: File, newValue: File): String {
        val p = ProcessBuilder("python3", "../tools/checksum-compare.py", old.path, newValue.path)
            .redirectErrorStream(true).start()
        val text = p.inputStream.bufferedReader().readText()
        check(p.waitFor(30, TimeUnit.SECONDS) && p.exitValue() == 0) { text }
        return text
    }

    private val old = metadata(Triple("a.bleibt", "1.0", "aaaa"), Triple("b.geht", "1.0", "bbbb"), Triple("c.kippt", "2.0", "1111"))
    private val newValue = metadata(Triple("a.bleibt", "1.0", "aaaa"), Triple("d.kommt", "3.0", "dddd"), Triple("c.kippt", "2.0", "2222"))

    @Test
    fun `a changed checksum with the same version stands out`() {
        val text = compare(old, newValue)
        assertTrue(text, text.contains("| 1 | 1 | 1 |"))
        assertTrue(text, text.contains("| `c.kippt:x:2.0` | `x-2.0.jar` | Prüfsumme |"))
    }

    private fun key(vararg items: String): File = File.createTempFile("vertrauen", ".xml").apply {
        deleteOnExit()
        writeText("""<?xml version="1.0" encoding="UTF-8"?>
<verification-metadata xmlns="https://schema.gradle.org/dependency-verification"><configuration><trusted-keys>
${items.joinToString("\n")}
</trusted-keys></configuration><components/></verification-metadata>""")
    }

    @Test
    fun `a newly trusted key with a group regex is highlighted at the front`() {
        val previous = """<trusted-key id="AAAA" group="org.alt"/>"""
        val text = compare(key(previous), key(previous,
            """<trusted-key id="BBBB" group="org.einzeln" name="x" version="1.0"/>""",
            """<trusted-key id="CCCC"><trusting group="^com[.]neu($|([.].*))" regex="true"/></trusted-key>"""))
        assertTrue(text, text.contains("### Neu vertraute Schlüssel (2)"))
        val regex = text.indexOf("| `CCCC` | `^com[.]neu($\\|([.].*))` | * | * | **JA")
        val single = text.indexOf("| `BBBB` | `org.einzeln` | x | 1.0 | nein |")
        assertTrue(text, regex in 0 until single)
        assertTrue("Der alte Schlüssel ist nicht neu", !text.contains("`AAAA`"))
    }

    @Test
    fun `a new group stands open, a known one does not`() {
        val text = compare(old, metadata(Triple("a.bleibt", "1.0", "aaaa"), Triple("a.bleibt", "2.0", "eeee"),
            Triple("d.kommt", "3.0", "dddd"), Triple("c.kippt", "2.0", "1111")))
        val section = text.substringAfter("### Neue Gruppen (1) — bitte ansehen", "").substringBefore("<details>")
        assertTrue(text, section.contains("- `d.kommt`") && !section.contains("a.bleibt"))
    }

    @Test
    fun `new and removed components are listed separately`() {
        val text = compare(old, newValue)
        assertTrue(text, Regex("Neu \\(1\\)[^<]*</summary>\\s*- `d.kommt:x:3.0`").containsMatchIn(text))
        assertTrue(text, Regex("Entfernt \\(1\\)[^<]*</summary>\\s*- `b.geht:x:1.0`").containsMatchIn(text))
        assertTrue("Ohne alte Datei ist alles neu", compare(File("fehlt.xml"), newValue).contains("| 3 | 0 | 0 |"))
    }
}
