package ch.brickinventoryapp

import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File
import java.util.concurrent.TimeUnit

/**
 * Die Zusammenfassung des Prüfsummen-Jobs (tools/pruefsummen-vergleich.py),
 * ausgeführt gegen zwei kleine Metadateien: eine neue, eine entfernte und eine
 * Komponente mit anderer Prüfsumme bei gleicher Fassung.
 *
 * Gegenproben (30.10.2026, gemessen): in vergleiche() `sa != sn` durch `False`
 * ersetzt → rot „eine geänderte Prüfsumme bei gleicher Fassung fällt auf“;
 * neu_k und weg_k vertauscht → rot „neue und entfernte Komponenten …“.
 */
class PruefsummenVergleichTest {

    private fun metadaten(vararg komponenten: Triple<String, String, String>): File =
        File.createTempFile("pruefsummen", ".xml").apply {
            deleteOnExit()
            writeText("""<?xml version="1.0" encoding="UTF-8"?>
<verification-metadata xmlns="https://schema.gradle.org/dependency-verification"><components>
""" + komponenten.joinToString("\n") { (gruppe, fassung, sha) ->
                """<component group="$gruppe" name="x" version="$fassung"><artifact name="x-$fassung.jar"><sha256 value="$sha"/></artifact></component>"""
            } + "\n</components></verification-metadata>")
        }

    private fun vergleiche(alt: File, neu: File): String {
        val p = ProcessBuilder("python3", "../tools/pruefsummen-vergleich.py", alt.path, neu.path)
            .redirectErrorStream(true).start()
        val text = p.inputStream.bufferedReader().readText()
        check(p.waitFor(30, TimeUnit.SECONDS) && p.exitValue() == 0) { text }
        return text
    }

    private val alt = metadaten(Triple("a.bleibt", "1.0", "aaaa"), Triple("b.geht", "1.0", "bbbb"), Triple("c.kippt", "2.0", "1111"))
    private val neu = metadaten(Triple("a.bleibt", "1.0", "aaaa"), Triple("d.kommt", "3.0", "dddd"), Triple("c.kippt", "2.0", "2222"))

    @Test
    fun `eine geaenderte Pruefsumme bei gleicher Fassung faellt auf`() {
        val text = vergleiche(alt, neu)
        assertTrue(text, text.contains("| 1 | 1 | 1 |"))
        assertTrue(text, text.contains("| `c.kippt:x:2.0` | `x-2.0.jar` | Prüfsumme |"))
    }

    @Test
    fun `neue und entfernte Komponenten stehen getrennt`() {
        val text = vergleiche(alt, neu)
        assertTrue(text, Regex("Neu \\(1\\)[^<]*</summary>\\s*- `d.kommt:x:3.0`").containsMatchIn(text))
        assertTrue(text, Regex("Entfernt \\(1\\)[^<]*</summary>\\s*- `b.geht:x:1.0`").containsMatchIn(text))
        assertTrue("Ohne alte Datei ist alles neu", vergleiche(File("fehlt.xml"), neu).contains("| 3 | 0 | 0 |"))
    }
}
