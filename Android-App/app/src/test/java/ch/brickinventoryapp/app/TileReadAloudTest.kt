package ch.brickinventoryapp.app

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.runtime.Composable
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.semantics.getOrNull
import androidx.compose.ui.test.hasClickAction
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.test.core.app.ApplicationProvider
import ch.brickinventoryapp.model.domain.FigureView
import ch.brickinventoryapp.model.domain.CatalogSetView
import ch.brickinventoryapp.model.domain.PartView
import ch.brickinventoryapp.catalog.ui.screens.CatalogSetCard
import ch.brickinventoryapp.parts.ui.screens.MinifigCard
import ch.brickinventoryapp.parts.ui.screens.PartCard
import ch.brickinventoryapp.shared.ui.TableRow
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
 * Counter-checks (patches under counter-checks/, measured only in CI — Robolectric):
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

    private val before = Locale.getDefault()
    private val images = SampleImages.loader(ApplicationProvider.getApplicationContext())

    init { Locale.setDefault(Locale.forLanguageTag("de-CH")) }

    @After
    fun tearDown() = Locale.setDefault(before)

    /** Descriptions and texts of the tappable node, in the order of the tree. */
    private fun announced(content: @Composable () -> Unit): String {
        compose.setContent {
            BrickInventoryManagerTheme {
                Surface(color = MaterialTheme.colorScheme.background) { content() }
            }
        }
        compose.waitForIdle()
        val node = compose.onNode(hasClickAction()).fetchSemanticsNode()
        val description = node.config.getOrNull(SemanticsProperties.ContentDescription).orEmpty()
        val texts = node.config.getOrNull(SemanticsProperties.Text).orEmpty().map { it.text }
        return (description + texts).joinToString(", ")
    }

    private fun check(was: String, read: String, name: String, units: List<String>) {
        assertEquals("$was: Name nicht genau einmal in „$read“", 1, read.windowed(name.length).count { it == name })
        assertTrue("$was: Zeichen statt Wort in „$read“", '×' !in read && '✓' !in read)
        units.forEach { assertTrue("$was: „$it“ fehlt in „$read“", it in read) }
    }

    @Test
    fun `parts tile reads name once and quantity with unit`() {
        // With an image: only then does the tile carry an image description that could double the name.
        val part = PartView(partNumber = "3001", partName = "Brick 2 x 4", colorName = "Red", totalQuantity = 12,
            imageUrl = "https://cdn.rebrickable.com/media/parts/3001.png")
        val read = announced { PartCard(part, serverUrl = "https://brick.example", imageLoader = images, onClick = {}) }
        check("Teilekachel", read, "Brick 2 x 4", listOf("12 Stück", "Teil 3001"))
    }

    @Test
    fun `figure tile reads name once and quantity with unit`() {
        val figure = FigureView(figNumber = "sw0001a", figName = "Battle Droid", quantity = 3, totalQuantity = 3)
        val read = announced { MinifigCard(figure, serverUrl = "", imageLoader = images, onClick = {}) }
        check("Figurenkachel", read, "Battle Droid", listOf("3 Stück", "Figur sw0001a"))
    }

    @Test
    fun `catalog tile names year, parts and ownership in words`() {
        val set = CatalogSetView(setNumber = "10305-1", name = "Lion Knights' Castle", year = 2022,
            numParts = 4514, owned = true, ownedQuantity = 2)
        val read = announced { CatalogSetCard(set, imageLoader = images, serverUrl = "", onClick = {}) }
        check("Katalogkachel", read, "Lion Knights' Castle",
            listOf("Jahr 2022", "${fmtInt(4514)} Teile", "In der Sammlung, 2 Exemplare", "Set 10305-1"))
    }

    /** Visible, not only read aloud: „500“ next to the brick symbol read like a price. */
    @Test
    fun `catalog tile shows the parts count with a word`() {
        val one = CatalogSetView(setNumber = "3001-1", name = "Ein Stein", year = 2022, numParts = 1)
        val many = CatalogSetView(setNumber = "10305-1", name = "Lion Knights' Castle", year = 2022, numParts = 4514)
        compose.setContent {
            BrickInventoryManagerTheme {
                Column {
                    CatalogSetCard(one, imageLoader = images, serverUrl = "", onClick = {})
                    CatalogSetCard(many, imageLoader = images, serverUrl = "", onClick = {})
                }
            }
        }
        compose.waitForIdle()
        listOf("1 Teil", "${fmtInt(4514)} Teile").forEach { text ->
            compose.onNode(androidx.compose.ui.test.hasText(text), useUnmergedTree = true).fetchSemanticsNode("„$text“ steht nicht sichtbar da")
        }
    }

    /** Font size in sp, as the text was actually set. */
    private fun size(text: String): Float {
        val outcome = mutableListOf<TextLayoutResult>()
        compose.onNode(androidx.compose.ui.test.hasText(text), useUnmergedTree = true).fetchSemanticsNode()
            .config[SemanticsActions.GetTextLayoutResult].action?.invoke(outcome)
        return outcome.single().layoutInput.style.fontSize.value
    }

    @Test
    fun `name, color and second line are at least 12 sp`() {
        val part = PartView(partNumber = "3001", partName = "Brick 2 x 4", colorName = "Red", totalQuantity = 12)
        announced {
            Column {
                PartCard(part, serverUrl = "", imageLoader = images)
                TableRow(imageUrl = null, number = "3002", name = "Brick 2 x 3", quantity = 2, imageLoader = images,
                    secondRow = "Bricks", onClick = {})
            }
        }
        val small = listOf("Brick 2 x 4", "Brick 2 x 3", "Bricks").associateWith { size(it) }.filterValues { it < 12f }
        assertTrue("Kerninformation unter 12 sp: $small", small.isEmpty())
    }

    @Test
    fun `table row reads name once and quantity with unit`() {
        val read = announced {
            TableRow(imageUrl = null, number = "3001", name = "Brick 2 x 4", quantity = 1250, imageLoader = images,
                onClick = {})
        }
        check("Tabellenzeile", read, "Brick 2 x 4", listOf("${fmtInt(1250)} Stück"))
    }
}
