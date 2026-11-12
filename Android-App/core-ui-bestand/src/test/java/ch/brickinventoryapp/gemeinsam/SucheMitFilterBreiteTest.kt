package ch.brickinventoryapp.gemeinsam

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.width
import androidx.compose.ui.Modifier
import androidx.compose.ui.test.hasSetTextAction
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.unit.dp
import ch.brickinventoryapp.gemeinsam.ui.SucheMitFilter
import ch.brickinventoryapp.ui.theme.BrickInventoryManagerTheme
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/**
 * Die Such- und Filterzeile über Galerie, Teilen und Figuren geht auf dem Tablet über die
 * ganze Breite des Rasters. Auf 720 dp begrenzt endete sie mitten über den Kacheln.
 *
 * Gegenprobe (gemessen nur in der CI — Robolectric):
 *   suche-wieder-begrenzt  Suchfeld wieder `widthIn(max = 720.dp)` → rot „auf dem Tablet geht …“
 */
@RunWith(RobolectricTestRunner::class)
@Config(qualifiers = "de-rCH-w1280dp-h800dp-land-xhdpi")
class SucheMitFilterBreiteTest {

    @get:Rule
    val compose = createComposeRule()

    @Test
    fun `auf dem Tablet geht die Suchzeile ueber die ganze Breite`() {
        compose.setContent {
            BrickInventoryManagerTheme {
                Box(Modifier.width(1200.dp)) {
                    SucheMitFilter(wert = "", onWert = {}, platzhalter = "Suche", aktiveFilter = 0, onFilter = {})
                }
            }
        }
        compose.waitForIdle()
        val feld = compose.onNode(hasSetTextAction()).fetchSemanticsNode().boundsInRoot
        val breite = feld.width / compose.density.density
        // Filterknopf und Ränder brauchen gut 100 dp; der Rest gehört dem Feld (vorher höchstens 720).
        assertTrue("Das Suchfeld ist nur $breite dp breit", breite > 1000f)
    }
}
