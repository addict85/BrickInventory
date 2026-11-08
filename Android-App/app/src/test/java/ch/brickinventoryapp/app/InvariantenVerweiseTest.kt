package ch.brickinventoryapp.app

import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File
import ch.brickinventoryapp.testing.Quellen

/**
 * INVARIANTEN.md verweist auf Quelldateien und Testklassen; ein Verweis auf
 * etwas, das umbenannt oder gelöscht wurde, führt Leser in die Irre. Geprüft
 * wird nur, dass es sie gibt, nicht, ob der Test die Regel noch ganz trägt.
 *
 * Gegenprobe (gegenproben/invarianten-verweis-ins-leere.patch): ein Verweis auf
 * `ui/GalleryFeature.kt` in INVARIANTEN.md → rot „jede in INVARIANTEN genannte …“.
 */
class InvariantenVerweiseTest {

    /** `*` steht für beliebige Zeichen innerhalb eines Namens, nie über einen Schrägstrich. */
    private fun muster(name: String) = Regex(name.split("*").joinToString("[^/]*") { Regex.escape(it) })

    private fun dateien(wurzel: File) = wurzel.walkTopDown().filter { it.isFile }
        .map { it.relativeTo(wurzel).invariantSeparatorsPath }.toList()

    @Test
    fun `jede in INVARIANTEN genannte Quelldatei und Testklasse gibt es`() {
        val doku = File(Quellen.projekt, "INVARIANTEN.md").readText()
        val quellen = dateien(Quellen.wurzel)
        val tests = dateien(Quellen.tests).map { it.substringAfterLast('/') }.toSet()
        val genannt = Regex("`([^`\\s]+\\.kt)`").findAll(doku).map { it.groupValues[1] }.toSet()
        val klassen = Regex("""\b[A-Z][A-Za-z0-9]*Test\b""").findAll(doku).map { it.value }.toSet()
        assertTrue("Nur ${genannt.size} Dateien, ${klassen.size} Testklassen gefunden — greift die Suche noch?",
            genannt.size >= 30 && klassen.size >= 20)
        val fehlt = genannt.filter { d ->
            val m = muster(d)
            quellen.none { m.matches(if ('/' in d) it else it.substringAfterLast('/')) }
        } + klassen.filter { "$it.kt" !in tests }.map { "$it (Testklasse)" }
        assertTrue("jede in INVARIANTEN.md genannte Datei und Testklasse muss es geben; fehlt:\n  " +
            fehlt.joinToString("\n  "), fehlt.isEmpty())
    }
}
