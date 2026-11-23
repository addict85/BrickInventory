package ch.brickinventoryapp.shared

import androidx.compose.foundation.layout.Column
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.semantics.getOrNull
import androidx.compose.ui.test.SemanticsMatcher
import androidx.compose.ui.test.junit4.v2.createComposeRule
import ch.brickinventoryapp.resources.R
import ch.brickinventoryapp.shared.ui.GalleryStatChip
import ch.brickinventoryapp.shared.ui.MetricsSeries
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
 * The key figures of collection, parts and figures (all eleven) with 1 and with 2, in
 * German and English: at 1 the singular is shown („1 Exemplar“, „1 copy“), never „1 Sets“.
 *
 * Counter-check (patch under counter-checks/, measured only in CI — Robolectric):
 *   metric-always-plural   GalleryStatChip always asks for the plural with 2 → red „bei 1 …“ (de and en)
 */
@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
class MetricsPluralTest {

    @get:Rule
    val compose = createComposeRule()

    private val before = Locale.getDefault()

    @After
    fun tearDown() = Locale.setDefault(before)

    private val all = listOf(
        R.plurals.gallery_stat_sets, R.plurals.gallery_stat_units, R.plurals.gallery_stat_parts,
        R.plurals.gallery_stat_minifigs, R.plurals.gallery_stat_instructions,
        R.plurals.minifigs_stat_types, R.plurals.minifigs_stat_total, R.plurals.minifigs_stat_manual,
        R.plurals.parts_stat_types, R.plurals.parts_stat_colors, R.plurals.parts_stat_total,
    )

    /** All the bar's texts, as TalkBack receives them. */
    private fun bar(language: String, count: Int): String {
        RuntimeEnvironment.setQualifiers("$language-w411dp-h891dp-port-xxhdpi")
        Locale.setDefault(Locale.forLanguageTag(language.replace("-r", "-")))
        compose.setContent {
            BrickInventoryManagerTheme {
                Surface(color = MaterialTheme.colorScheme.background) {
                    Column { MetricsSeries { all.forEach { GalleryStatChip(count, it) } } }
                }
            }
        }
        compose.waitForIdle()
        return compose.onAllNodes(SemanticsMatcher("Text") { it.config.getOrNull(SemanticsProperties.Text) != null })
            .fetchSemanticsNodes().joinToString(" | ") { n ->
                n.config.getOrNull(SemanticsProperties.Text).orEmpty().joinToString("") { it.text }
            }
    }

    private val plural = Regex("\\b1 (Sets|Exemplare|Teile|Minifiguren|Anleitungen|Minifigurensorten|Teilesorten|Farben" +
        "|sets|copies|parts|minifigures|manuals|minifigure types|part types|colors)\\b")

    @Test
    fun `at 1 German shows the singular`() {
        val text = bar("de-rCH", 1)
        assertEquals("plural at 1: $text", null, plural.find(text)?.value)
        assertTrue(text, "1 Exemplar" in text && "1 Anleitung" in text && "1 Teilesorte" in text)
    }

    @Test
    fun `at 1 English shows the singular`() {
        val text = bar("en-rGB", 1)
        assertEquals("plural at 1: $text", null, plural.find(text)?.value)
        assertTrue(text, "1 copy" in text && "1 minifigure" in text && "1 color" in text)
    }

    @Test
    fun `at 2 the plural is shown`() {
        val text = bar("de-rCH", 2)
        assertTrue(text, "2 Exemplare" in text && "2 Anleitungen" in text && "2 Minifigurensorten" in text)
    }
}
