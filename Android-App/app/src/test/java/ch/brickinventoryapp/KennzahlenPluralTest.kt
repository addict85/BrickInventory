package ch.brickinventoryapp

import androidx.compose.foundation.layout.Column
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.semantics.getOrNull
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.SemanticsMatcher
import ch.brickinventoryapp.ressourcen.R
import ch.brickinventoryapp.ui.screens.GalleryStatChip
import ch.brickinventoryapp.ui.screens.KennzahlenReihe
import ch.brickinventoryapp.ui.theme.BrickInventoryManagerTheme
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.GraphicsMode
import java.util.Locale

/**
 * Die Kennzahlen von Sammlung, Teilen und Figuren (alle elf) mit 1 und mit 2, auf
 * Deutsch und Englisch: Bei 1 steht die Einzahl („1 Exemplar“, „1 copy“), nie „1 Sets“.
 *
 * Gegenprobe (Patch unter gegenproben/, gemessen nur in der CI — Robolectric):
 *   kennzahl-immer-mehrzahl   GalleryStatChip fragt den Plural immer mit 2 → rot „bei 1 …“ (de und en)
 */
@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
class KennzahlenPluralTest {

    @get:Rule
    val compose = createComposeRule()

    private val vorher = Locale.getDefault()

    @After
    fun zu() = Locale.setDefault(vorher)

    private val alle = listOf(
        R.plurals.gallery_stat_sets, R.plurals.gallery_stat_units, R.plurals.gallery_stat_parts,
        R.plurals.gallery_stat_minifigs, R.plurals.gallery_stat_instructions,
        R.plurals.minifigs_stat_types, R.plurals.minifigs_stat_total, R.plurals.minifigs_stat_manual,
        R.plurals.parts_stat_types, R.plurals.parts_stat_colors, R.plurals.parts_stat_total,
    )

    /** Alle Texte der Leiste, wie TalkBack sie bekommt. */
    private fun leiste(sprache: String, anzahl: Int): String {
        RuntimeEnvironment.setQualifiers("$sprache-w411dp-h891dp-port-xxhdpi")
        Locale.setDefault(Locale.forLanguageTag(sprache.replace("-r", "-")))
        compose.setContent {
            BrickInventoryManagerTheme {
                Surface(color = MaterialTheme.colorScheme.background) {
                    Column { KennzahlenReihe { alle.forEach { GalleryStatChip(anzahl, it) } } }
                }
            }
        }
        compose.waitForIdle()
        return compose.onAllNodes(SemanticsMatcher("Text") { it.config.getOrNull(SemanticsProperties.Text) != null })
            .fetchSemanticsNodes().joinToString(" | ") { n ->
                n.config.getOrNull(SemanticsProperties.Text).orEmpty().joinToString("") { it.text }
            }
    }

    private val mehrzahl = Regex("\\b1 (Sets|Exemplare|Teile|Minifiguren|Anleitungen|Minifigurensorten|Teilesorten|Farben" +
        "|sets|copies|parts|minifigures|manuals|minifigure types|part types|colors)\\b")

    @Test
    fun `bei 1 steht auf Deutsch die Einzahl`() {
        val text = leiste("de-rCH", 1)
        assertEquals("Mehrzahl bei 1: $text", null, mehrzahl.find(text)?.value)
        assertTrue(text, "1 Exemplar" in text && "1 Anleitung" in text && "1 Teilesorte" in text)
    }

    @Test
    fun `bei 1 steht auf Englisch die Einzahl`() {
        val text = leiste("en-rGB", 1)
        assertEquals("Mehrzahl bei 1: $text", null, mehrzahl.find(text)?.value)
        assertTrue(text, "1 copy" in text && "1 minifigure" in text && "1 color" in text)
    }

    @Test
    fun `bei 2 steht die Mehrzahl`() {
        val text = leiste("de-rCH", 2)
        assertTrue(text, "2 Exemplare" in text && "2 Anleitungen" in text && "2 Minifigurensorten" in text)
    }
}
