package ch.brickinventoryapp.collection

import android.content.Context
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.width
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.semantics.SemanticsActions
import androidx.compose.ui.semantics.getOrNull
import androidx.compose.ui.test.SemanticsNodeInteraction
import androidx.compose.ui.test.hasClickAction
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.text.TextLayoutResult
import androidx.compose.ui.unit.Density
import androidx.compose.ui.unit.dp
import androidx.test.core.app.ApplicationProvider
import ch.brickinventoryapp.collection.ui.TilePrice
import ch.brickinventoryapp.collection.ui.screens.SetCard
import ch.brickinventoryapp.model.appearance.Design
import ch.brickinventoryapp.model.domain.Condition
import ch.brickinventoryapp.model.domain.CurrencyCode
import ch.brickinventoryapp.model.domain.Money
import ch.brickinventoryapp.model.domain.SetView
import ch.brickinventoryapp.ui.theme.BrickInventoryManagerTheme
import ch.brickinventoryapp.ui.util.fmtMoney
import ch.brickinventoryapp.ui.util.fmtPercent
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

/**
 * The gallery's set tile: at 200 % font neither the amount nor the percentage wraps,
 * and tiles of a row are equally high, however long their name is; a short name
 * therefore leaves no blank line underneath it.
 *
 * Counter-checks (patches under counter-checks/, measured only in the CI — Robolectric):
 *   large-font-tile-row       percentage next to the amount in a Row again → red “tile …”
 *   tile-height-by-content        the missing name line without compensation → red “tiles of a row …”
 *   tile-padding-only-when-needed compensation only when a line is missing, then costs one column gap
 *                                   more → red “tiles of a row …” (1 dp)
 *   tile-name-two-fixed-lines   minLines = 2 on the name again → red “a short name …”
 */
@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(qualifiers = "de-rCH-w411dp-h891dp-port-xxhdpi")
class SetTileTest {

    @get:Rule
    val compose = createComposeRule()

    private val before = Locale.getDefault()
    private val ctx: Context = ApplicationProvider.getApplicationContext()

    init { Locale.setDefault(Locale.forLanguageTag("de-CH")) }

    @After
    fun tearDown() = Locale.setDefault(before)

    private fun show(font: Float = 1f, content: @Composable () -> Unit) {
        compose.setContent {
            BrickInventoryManagerTheme(theme = Design.CLASSIC) {
                val d = LocalDensity.current
                CompositionLocalProvider(LocalDensity provides Density(d.density, font)) {
                    Surface(color = MaterialTheme.colorScheme.background) { content() }
                }
            }
        }
        compose.waitForIdle()
    }

    private fun rows(node: SemanticsNodeInteraction): Int {
        val outcome = mutableListOf<TextLayoutResult>()
        node.fetchSemanticsNode().config.getOrNull(SemanticsActions.GetTextLayoutResult)?.action?.invoke(outcome)
        return outcome.single().lineCount
    }

    @Test
    fun `tile at 200 percent wraps neither amount nor percent`() {
        val images = coil3.ImageLoader.Builder(ctx).build()
        show(font = 2f) {
            Box(Modifier.width(188.dp)) {
                SetCard(SetView(setNumber = "75192-1", name = "Millennium Falcon", theme = "Star Wars"),
                    serverUrl = "", imageLoader = images, onClick = {},
                    price = TilePrice(Money.from(812.5), 16.1), currency = CurrencyCode.CHF)
            }
        }
        assertEquals("percent", 1, rows(compose.onNodeWithText(fmtPercent(16.1), useUnmergedTree = true)))
        assertEquals("amount", 1, rows(compose.onNodeWithText(fmtMoney(812.5, CurrencyCode.CHF), useUnmergedTree = true)))
    }

    @Test
    fun `tiles of a row are equally high`() {
        val images = coil3.ImageLoader.Builder(ctx).build()
        val full = SetView(setNumber = "10294-1", name = "Titanic mit sehr langem Namen über zwei Zeilen",
            theme = "Icons", pieces = 9090, condition = Condition.NEW)
        val sparse = SetView(setNumber = "1-1", name = "Box")
        show {
            Row(Modifier.width(380.dp)) {
                Box(Modifier.weight(1f)) {
                    SetCard(full, "", images, {}, price = TilePrice(Money.from(449.95), 12.5), currency = CurrencyCode.CHF)
                }
                Box(Modifier.weight(1f)) { SetCard(sparse, "", images, {}, currency = CurrencyCode.CHF) }
            }
        }
        val a = compose.onNode(hasText("10294-1") and hasClickAction()).fetchSemanticsNode().boundsInRoot
        val b = compose.onNode(hasText("1-1") and hasClickAction()).fetchSemanticsNode().boundsInRoot
        assertEquals("tiles of a row equally high", a.height, b.height, 1f)
    }

    @Test
    fun `a short name leaves no empty line below it`() {
        val images = coil3.ImageLoader.Builder(ctx).build()
        show {
            Box(Modifier.width(188.dp)) {
                SetCard(SetView(setNumber = "1-1", name = "Box"), "", images, {}, currency = CurrencyCode.CHF)
            }
        }
        val node = compose.onNodeWithText("Box", useUnmergedTree = true)
        val outcome = mutableListOf<TextLayoutResult>()
        node.fetchSemanticsNode().config.getOrNull(SemanticsActions.GetTextLayoutResult)?.action?.invoke(outcome)
        val row = outcome.single().let { it.getLineBottom(0) - it.getLineTop(0) }
        val height = node.fetchSemanticsNode().boundsInRoot.height
        assertTrue("the name is $height px high, one line $row px", height < row * 1.5f)
    }
}
