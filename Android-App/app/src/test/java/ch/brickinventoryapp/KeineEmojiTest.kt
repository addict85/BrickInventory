package ch.brickinventoryapp

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

/**
 * Oberflächentexte und Bildschirme tragen keine Emoji, sondern Material-Symbole.
 *
 * Emoji sehen je nach Hersteller anders aus, bringen Farben mit, die kein
 * Design kennt, und TalkBack liest ihren Namen mit. Typografische Zeichen wie
 * ✓, ✕ oder ▾ sind keine Emoji und bleiben erlaubt.
 *
 * Gegenprobe: `Text("📅 …")` in AcquisitionManagementScreen.kt zurückgesetzt —
 * der erste Test rot mit Datei und Zeile; "✅ " vor vm_set_added in
 * values-de/strings.xml — ebenfalls rot. Der dritte Test prüft das Muster selbst.
 */
class KeineEmojiTest {

    private val emoji = Regex("[\\x{1F000}-\\x{1FAFF}\\x{2600}-\\x{26FF}\\x{23E9}-\\x{23FA}\\x{2705}\\x{274C}\\x{2728}\\x{2B50}\\x{FE0F}]")

    @Test
    fun `kein Emoji im Kotlin-Quelltext`() {
        val fehler = Quellen.alle().flatMap { datei ->
            Quellen.ohneKommentare(datei.readText()).lines().mapIndexedNotNull { i, zeile ->
                if (emoji.containsMatchIn(zeile)) "${datei.name}:${i + 1}  ${zeile.trim()}" else null
            }
        }
        assertTrue("Emoji statt Symbol:\n  " + fehler.joinToString("\n  "), fehler.isEmpty())
    }

    @Test
    fun `kein Emoji in den Texten`() {
        val fehler = listOf("values", "values-de").flatMap { ordner ->
            File("src/main/res/$ordner/strings.xml").readLines().mapIndexedNotNull { i, zeile ->
                if (!zeile.trim().startsWith("<!--") && emoji.containsMatchIn(zeile))
                    "$ordner/strings.xml:${i + 1}  ${zeile.trim()}" else null
            }
        }
        assertTrue("Emoji in Texten:\n  " + fehler.joinToString("\n  "), fehler.isEmpty())
    }

    @Test
    fun `das Muster erkennt Emoji und laesst Schriftzeichen stehen`() {
        listOf("📅", "⚠️", "⏳", "✅", "❌", "👷", "🔍").forEach {
            assertTrue("nicht erkannt: $it", emoji.containsMatchIn(it))
        }
        listOf("✓ ×2", "✕", "▾", "—", "€", "Größe").forEach {
            assertFalse("fälschlich erkannt: $it", emoji.containsMatchIn(it))
        }
    }
}
