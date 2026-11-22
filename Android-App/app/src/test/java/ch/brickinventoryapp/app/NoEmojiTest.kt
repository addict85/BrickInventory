package ch.brickinventoryapp.app

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File
import ch.brickinventoryapp.testing.Quellen

/**
 * UI texts and screens carry no emoji but Material symbols.
 *
 * Emoji look different depending on the manufacturer, bring colors that no
 * design knows, and TalkBack reads their name along. Typographic characters like
 * ✓, ✕ or ▾ are not emoji and stay allowed.
 *
 * Counter-check: `Text("📅 …")` restored in AcquisitionManagementScreen.kt —
 * the first test red with file and line; "✅ " before vm_set_added in
 * values-de/strings.xml — red as well. The third test checks the pattern itself.
 */
class NoEmojiTest {

    private val emoji = Regex("[\\x{1F000}-\\x{1FAFF}\\x{2600}-\\x{26FF}\\x{23E9}-\\x{23FA}\\x{2705}\\x{274C}\\x{2728}\\x{2B50}\\x{FE0F}]")

    @Test
    fun `no emoji in the Kotlin source`() {
        val fehler = Quellen.alle().flatMap { datei ->
            Quellen.withoutComments(datei.readText()).lines().mapIndexedNotNull { i, zeile ->
                if (emoji.containsMatchIn(zeile)) "${datei.name}:${i + 1}  ${zeile.trim()}" else null
            }
        }
        assertTrue("Emoji statt Symbol:\n  " + fehler.joinToString("\n  "), fehler.isEmpty())
    }

    @Test
    fun `no emoji in the texts`() {
        val fehler = listOf("values", "values-de").flatMap { folder ->
            File(Quellen.res, "$folder/strings.xml").readLines().mapIndexedNotNull { i, zeile ->
                if (!zeile.trim().startsWith("<!--") && emoji.containsMatchIn(zeile))
                    "$folder/strings.xml:${i + 1}  ${zeile.trim()}" else null
            }
        }
        assertTrue("Emoji in Texten:\n  " + fehler.joinToString("\n  "), fehler.isEmpty())
    }

    @Test
    fun `the pattern recognizes emoji and leaves script characters alone`() {
        listOf("📅", "⚠️", "⏳", "✅", "❌", "👷", "🔍").forEach {
            assertTrue("nicht erkannt: $it", emoji.containsMatchIn(it))
        }
        listOf("✓ ×2", "✕", "▾", "—", "€", "Größe").forEach {
            assertFalse("fälschlich erkannt: $it", emoji.containsMatchIn(it))
        }
    }
}
