package ch.brickinventoryapp.app

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.runtime.Composable
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.semantics.getOrNull
import androidx.compose.ui.test.hasClickAction
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.test.core.app.ApplicationProvider
import ch.brickinventoryapp.model.domain.FigurAnsicht
import ch.brickinventoryapp.model.domain.KatalogSetAnsicht
import ch.brickinventoryapp.model.domain.TeilAnsicht
import ch.brickinventoryapp.catalog.ui.screens.CatalogSetCard
import ch.brickinventoryapp.parts.ui.screens.MinifigCard
import ch.brickinventoryapp.parts.ui.screens.PartCard
import ch.brickinventoryapp.shared.ui.TabellenZeile
import ch.brickinventoryapp.ui.theme.BrickInventoryManagerTheme
import ch.brickinventoryapp.ui.util.fmtInt
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode
import java.util.Locale
import androidx.compose.foundation.layout.Column
import androidx.compose.ui.semantics.SemanticsActions
import androidx.compose.ui.text.TextLayoutResult

/**
 * What TalkBack reads on part, figure and catalog tile and on the table row
 * (the merged node for tapping): the name exactly once, no „×“ and no
 * „✓“, and every quantity with a unit („12 Stück“, „4'514 Teile“, „Jahr 2022“). In addition
 * name, color and second line stand in at least 12 sp (not labelSmall).
 *
 * Counter-checks (patches under gegenproben/, measured only in CI — Robolectric):
 *   teilekachel-bild-mit-namen    image of the parts tile again described with the name → red “parts tile …”
 *   menge-als-zeichen             readAloudAs() does nothing → red in the four read-aloud tests („×“ or „✓“)
 *   teilename-klein               part name again labelSmall (11 sp) → red “name, color and second line …”
 *   katalog-teile-ohne-wort       parts count again only as a number → red “catalog tile shows the parts count …”
 */
@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(qualifiers = "de-rCH-w411dp-h891dp-port-xxhdpi")
class TileReadAloudTest {

    @get:Rule
    val compose = createComposeRule()

    private val vorher = Locale.getDefault()
    private val bilder = SampleImages.loader(ApplicationProvider.getApplicationContext())

    init { Locale.setDefault(Locale.forLanguageTag("de-CH")) }

    @After
    fun zu() = Locale.setDefault(vorher)

    /** Descriptions and texts of the tappable node, in the order of the tree. */
    private fun vorgelesen(inhalt: @Composable () -> Unit): String {
        compose.setContent {
            BrickInventoryManagerTheme {
                Surface(color = MaterialTheme.colorScheme.background) { inhalt() }
            }
        }
        compose.waitForIdle()
        val node = compose.onNode(hasClickAction()).fetchSemanticsNode()
        val beschreibung = node.config.getOrNull(SemanticsProperties.ContentDescription).orEmpty()
        val texts = node.config.getOrNull(SemanticsProperties.Text).orEmpty().map { it.text }
        return (beschreibung + texts).joinToString(", ")
    }

    private fun pruefe(was: String, gelesen: String, name: String, units: List<String>) {
        assertEquals("$was: Name nicht genau einmal in „$gelesen“", 1, gelesen.windowed(name.length).count { it == name })
        assertTrue("$was: Zeichen statt Wort in „$gelesen“", '×' !in gelesen && '✓' !in gelesen)
        units.forEach { assertTrue("$was: „$it“ fehlt in „$gelesen“", it in gelesen) }
    }

    @Test
    fun `parts tile reads name once and quantity with unit`() {
        // With an image: only then does the tile carry an image description that could double the name.
        val teil = TeilAnsicht(partNumber = "3001", partName = "Brick 2 x 4", colorName = "Red", totalQuantity = 12,
            imageUrl = "https://cdn.rebrickable.com/media/parts/3001.png")
        val gelesen = vorgelesen { PartCard(teil, serverUrl = "https://brick.example", imageLoader = bilder, onClick = {}) }
        pruefe("Teilekachel", gelesen, "Brick 2 x 4", listOf("12 Stück", "Teil 3001"))
    }

    @Test
    fun `figure tile reads name once and quantity with unit`() {
        val figur = FigurAnsicht(figNumber = "sw0001a", figName = "Battle Droid", quantity = 3, totalQuantity = 3)
        val gelesen = vorgelesen { MinifigCard(figur, serverUrl = "", imageLoader = bilder, onClick = {}) }
        pruefe("Figurenkachel", gelesen, "Battle Droid", listOf("3 Stück", "Figur sw0001a"))
    }

    @Test
    fun `catalog tile names year, parts and ownership in words`() {
        val set = KatalogSetAnsicht(setNumber = "10305-1", name = "Lion Knights' Castle", year = 2022,
            numParts = 4514, owned = true, ownedQuantity = 2)
        val gelesen = vorgelesen { CatalogSetCard(set, imageLoader = bilder, serverUrl = "", onClick = {}) }
        pruefe("Katalogkachel", gelesen, "Lion Knights' Castle",
            listOf("Jahr 2022", "${fmtInt(4514)} Teile", "In der Sammlung, 2 Exemplare", "Set 10305-1"))
    }

    /** Visible, not only read aloud: „500“ next to the brick symbol read like a price. */
    @Test
    fun `catalog tile shows the parts count with a word`() {
        val einer = KatalogSetAnsicht(setNumber = "3001-1", name = "Ein Stein", year = 2022, numParts = 1)
        val viele = KatalogSetAnsicht(setNumber = "10305-1", name = "Lion Knights' Castle", year = 2022, numParts = 4514)
        compose.setContent {
            BrickInventoryManagerTheme {
                Column {
                    CatalogSetCard(einer, imageLoader = bilder, serverUrl = "", onClick = {})
                    CatalogSetCard(viele, imageLoader = bilder, serverUrl = "", onClick = {})
                }
            }
        }
        compose.waitForIdle()
        listOf("1 Teil", "${fmtInt(4514)} Teile").forEach { text ->
            compose.onNode(androidx.compose.ui.test.hasText(text), useUnmergedTree = true).fetchSemanticsNode("„$text“ steht nicht sichtbar da")
        }
    }

    /** Font size in sp, as the text was actually set. */
    private fun groesse(text: String): Float {
        val ergebnis = mutableListOf<TextLayoutResult>()
        compose.onNode(androidx.compose.ui.test.hasText(text), useUnmergedTree = true).fetchSemanticsNode()
            .config[SemanticsActions.GetTextLayoutResult].action?.invoke(ergebnis)
        return ergebnis.single().layoutInput.style.fontSize.value
    }

    @Test
    fun `name, color and second line are at least 12 sp`() {
        val teil = TeilAnsicht(partNumber = "3001", partName = "Brick 2 x 4", colorName = "Red", totalQuantity = 12)
        vorgelesen {
            Column {
                PartCard(teil, serverUrl = "", imageLoader = bilder)
                TabellenZeile(bildUrl = null, nummer = "3002", name = "Brick 2 x 3", menge = 2, imageLoader = bilder,
                    secondRow = "Bricks", onClick = {})
            }
        }
        val klein = listOf("Brick 2 x 4", "Brick 2 x 3", "Bricks").associateWith { groesse(it) }.filterValues { it < 12f }
        assertTrue("Kerninformation unter 12 sp: $klein", klein.isEmpty())
    }

    @Test
    fun `table row reads name once and quantity with unit`() {
        val gelesen = vorgelesen {
            TabellenZeile(bildUrl = null, nummer = "3001", name = "Brick 2 x 4", menge = 1250, imageLoader = bilder,
                onClick = {})
        }
        pruefe("Tabellenzeile", gelesen, "Brick 2 x 4", listOf("${fmtInt(1250)} Stück"))
    }
}
