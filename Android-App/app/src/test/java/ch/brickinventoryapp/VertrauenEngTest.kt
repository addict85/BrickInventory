package ch.brickinventoryapp

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File
import java.util.concurrent.TimeUnit

/**
 * tools/vertrauen-eng.py (sec10 H5), ausgeführt gegen kleine Metadateien: Eine
 * Gruppen-Regex an einem PGP-Schlüssel wird durch die Gruppen ersetzt, die sie in
 * derselben Datei trifft, und deckt danach kein künftiges Paket mehr.
 *
 * Gegenprobe: in eng() `gefunden = list(alle)` statt der Treffer der Regex → rot
 * „eine Gruppen-Regex wird auf die gebauten Gruppen begrenzt“ (auch org.fremd
 * wurde vertraut); gegenproben/vertrauen-alle-gruppen.patch
 */
class VertrauenEngTest {

    private fun metadaten(schluessel: String): File = File.createTempFile("vertrauen", ".xml").apply {
        deleteOnExit()
        writeText("""<?xml version="1.0" encoding="UTF-8"?>
<verification-metadata xmlns="https://schema.gradle.org/dependency-verification">
   <configuration>
      <trusted-keys>
$schluessel
      </trusted-keys>
   </configuration>
   <components>
      <component group="com.google.guava" name="guava" version="1"/>
      <component group="com.google.dagger" name="dagger" version="1"/>
      <component group="org.fremd" name="x" version="1"/>
   </components>
</verification-metadata>
""")
    }

    private fun eng(datei: File): Int {
        val p = ProcessBuilder("python3", "../tools/vertrauen-eng.py", datei.path).redirectErrorStream(true).start()
        val text = p.inputStream.bufferedReader().readText()
        check(p.waitFor(30, TimeUnit.SECONDS)) { text }
        return p.exitValue()
    }

    @Test
    fun `eine Gruppen-Regex wird auf die gebauten Gruppen begrenzt`() {
        val datei = metadaten("""
         <trusted-key id="AAAA" group="^com[.]google(${'$'}|([.].*))" regex="true"/>
         <trusted-key id="BBBB">
            <trusting group="androidx.core"/>
            <trusting group="^com[.]google[.]dagger(${'$'}|([.].*))" regex="true"/>
         </trusted-key>""".trimStart('\n'))
        assertEquals(0, eng(datei))
        val text = datei.readText()
        assertFalse("Eine Regex blieb stehen:\n$text", text.contains("regex="))
        val a = text.substringAfter("id=\"AAAA\"").substringBefore("</trusted-key>")
        assertTrue(a, a.contains("<trusting group=\"com.google.guava\"/>") && a.contains("<trusting group=\"com.google.dagger\"/>"))
        assertFalse("Eine fremde Gruppe wurde vertraut: $a", a.contains("org.fremd"))
        val b = text.substringAfter("id=\"BBBB\"").substringBefore("</trusted-key>")
        assertTrue(b, b.contains("<trusting group=\"androidx.core\"/>") && b.contains("<trusting group=\"com.google.dagger\"/>"))
        assertFalse(b, b.contains("guava"))
        assertTrue("Die Datei bleibt lesbar", javax.xml.parsers.DocumentBuilderFactory.newInstance()
            .newDocumentBuilder().parse(datei).documentElement.getElementsByTagName("trusting").length == 4)
    }

    @Test
    fun `eine Regex ohne Treffer wird gemeldet statt still entfernt`() {
        val datei = metadaten("""         <trusted-key id="CCCC" group="^org[.]nirgends(${'$'}|([.].*))" regex="true"/>""")
        val vorher = datei.readText()
        assertEquals(1, eng(datei))
        assertEquals("Ungeschrieben", vorher, datei.readText())
    }
}
