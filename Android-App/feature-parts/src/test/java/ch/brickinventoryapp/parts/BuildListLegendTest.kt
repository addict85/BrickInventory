package ch.brickinventoryapp.parts

import androidx.activity.ComponentActivity
import androidx.compose.ui.test.junit4.v2.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithText
import ch.brickinventoryapp.resources.R
import ch.brickinventoryapp.parts.ui.PlPart
import ch.brickinventoryapp.parts.ui.TeilelisteUiState
import ch.brickinventoryapp.parts.ui.screens.PartsListScreen
import ch.brickinventoryapp.parts.ui.screens.buildListsGroups
import ch.brickinventoryapp.ui.theme.BrickInventoryManagerTheme
import coil3.ImageLoader
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/**
 * Die Bauliste mit eingetragenem Bestand: Über der Liste steht die Legende der Farben,
 * jede Zeile schreibt „Benötigt“ und „Vorhanden“ aus, und die Minifiguren stehen in
 * einer eigenen Gruppe am Ende statt unter „(Keine Farbe)“ zwischen den Teilen.
 *
 * Gegenproben (Patches unter gegenproben/, Robolectric, misst die CI):
 *   bauliste-ohne-legende      die Legende fehlt → rot „ueber der Liste steht …“
 *   bauliste-pille-als-zeichen „Vorhanden“ wieder als „8/12“ → rot „ueber der Liste steht …“
 *   bauliste-figuren-gemischt  Figuren wieder nach Farbe gruppiert → rot „die Minifiguren …“
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35], qualifiers = "de-rCH-w411dp-h2400dp-port-xxhdpi")
class BuildListLegendTest {

    @get:Rule
    val compose = createAndroidComposeRule<ComponentActivity>()

    private fun text(id: Int, vararg a: Any) = compose.activity.getString(id, *a)

    private val stein = PlPart(partNumber = "3001", partName = "Brick 2 x 4", colorName = "Red", colorHex = "C91A09",
        colorId = 4, quantity = 12, imageUrl = null, vorhanden = 8)
    private val platte = PlPart(partNumber = "3020", partName = "Plate 2 x 4", colorName = "Light Bluish Gray",
        colorHex = "A0A5A9", colorId = 71, quantity = 30, imageUrl = null, vorhanden = 30)
    private val sticker = PlPart(partNumber = "75192stk01", partName = "Sticker Sheet", colorName = "",
        colorHex = null, quantity = 1, imageUrl = null, vorhanden = 0)
    private val luke = PlPart(partNumber = "sw0001", partName = "Luke Skywalker", colorName = "", colorHex = null,
        quantity = 1, imageUrl = null, isFig = true, vorhanden = 0)

    @Test
    fun `ueber der Liste steht die Legende, die Zeilen schreiben ihre Mengen aus`() {
        compose.setContent {
            BrickInventoryManagerTheme {
                PartsListScreen(TeilelisteUiState(parts = listOf(stein, platte, luke), generated = true),
                    serverUrl = "", imageLoader = ImageLoader.Builder(compose.activity).build(), onScanBarcode = {})
            }
        }
        compose.waitForIdle()
        compose.onNodeWithText(text(R.string.partslist_legende)).fetchSemanticsNode("Legende fehlt")
        for (t in listOf(text(R.string.partslist_benoetigt, "12"), text(R.string.partslist_vorhanden_von, "8", "12"),
                         text(R.string.partslist_vorhanden, "30"))) {
            compose.onNodeWithText(t, useUnmergedTree = true).fetchSemanticsNode("„$t“ fehlt")
        }
        val kopf = compose.onNodeWithText(text(R.string.detail_minifigs), useUnmergedTree = true)
            .fetchSemanticsNode("Keine Gruppe Minifiguren").positionInRoot.y
        val figur = compose.onNodeWithText("Luke Skywalker", useUnmergedTree = true).fetchSemanticsNode().positionInRoot.y
        assertTrue("Luke steht nicht unter dem Kopf „Minifiguren“", figur > kopf)
    }

    @Test
    fun `die Minifiguren bilden eine eigene Gruppe am Ende`() {
        val groups = buildListsGroups(listOf(luke, stein, sticker, platte))
        assertEquals(listOf("", "Light Bluish Gray", "Red", null), groups.map { it.first })
        assertEquals(listOf(sticker), groups.first().second)
        assertEquals(listOf(luke), groups.last().second)
    }
}
