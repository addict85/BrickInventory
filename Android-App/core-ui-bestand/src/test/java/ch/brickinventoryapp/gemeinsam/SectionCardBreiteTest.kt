package ch.brickinventoryapp.gemeinsam

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.width
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.unit.dp
import ch.brickinventoryapp.gemeinsam.ui.LocalSpaltenkarte
import ch.brickinventoryapp.gemeinsam.ui.SectionCard
import ch.brickinventoryapp.ui.theme.Abstaende
import ch.brickinventoryapp.ui.theme.BrickInventoryManagerTheme
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/**
 * Die Abschnittskarte des Set-Details: einspaltig auf Lesebreite begrenzt, in einer
 * Spalte des Tablet-Layouts so breit wie die Spalte (abzüglich Rand). Schmaler stand
 * sie mittig in einer 640 dp breiten Spalte, mit leerem Rand links und rechts.
 *
 * Gegenprobe (gemessen nur in der CI — Robolectric):
 *   sectioncard-in-spalte-schmal  SectionCard liest LocalSpaltenkarte nicht (immer mittigBis)
 *                                 → rot „in einer Spalte nimmt die Karte die volle Breite“
 */
@RunWith(RobolectricTestRunner::class)
@Config(qualifiers = "de-rCH-w1280dp-h800dp-land-xhdpi")
class SectionCardBreiteTest {

    @get:Rule
    val compose = createComposeRule()

    /** Die Breite des Karteninhalts in dp; er füllt die Karte bis auf ihren Innenrand. */
    private fun inhaltsbreite(spalte: Boolean): Float {
        compose.setContent {
            BrickInventoryManagerTheme {
                CompositionLocalProvider(LocalSpaltenkarte provides spalte) {
                    Box(Modifier.width(800.dp)) {
                        SectionCard("Angaben") { Box(Modifier.fillMaxWidth().height(8.dp).testTag("inhalt")) }
                    }
                }
            }
        }
        compose.waitForIdle()
        return compose.onNodeWithTag("inhalt").fetchSemanticsNode().size.width / compose.density.density
    }

    @Test
    fun `einspaltig bleibt die Karte auf Lesebreite`() {
        assertTrue("Breiter als die Lesebreite", inhaltsbreite(spalte = false) <= 560f)
    }

    @Test
    fun `in einer Spalte nimmt die Karte die volle Breite`() {
        val erwartet = 800f - 4 * Abstaende.gross.value
        assertEquals(erwartet, inhaltsbreite(spalte = true), 1f)
    }
}
