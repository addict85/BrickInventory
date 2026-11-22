package ch.brickinventoryapp.shared

import ch.brickinventoryapp.model.domain.Money
import android.content.Context
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.padding
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
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.text.TextLayoutResult
import androidx.compose.ui.unit.Density
import androidx.compose.ui.unit.dp
import androidx.test.core.app.ApplicationProvider
import ch.brickinventoryapp.shared.ui.AcquisitionSummarySection
import ch.brickinventoryapp.shared.ui.ValueTiles
import ch.brickinventoryapp.model.domain.CurrencyCode
import ch.brickinventoryapp.model.domain.PurchaseView
import ch.brickinventoryapp.model.ui.theme.Design
import ch.brickinventoryapp.resources.R
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
 * Value tiles and purchase price of the set detail: four-digit amounts stay on a
 * narrow phone entirely on one line, and at 200% text size the purchase price sits
 * below its label.
 *
 * Counter-checks (patches under counter-checks/, measured only in CI — Robolectric):
 *   wertkacheln-immer-drei          value tiles always three side by side → red „Wert-Kacheln … 100 Prozent“
 *   grosse-schrift-kaufpreis-daneben purchase price next to the label → red „Kaufpreis …“
 */
@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(qualifiers = "de-rCH-w411dp-h891dp-port-xxhdpi")
class ValueTilesTest {

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

    /**
     * Checks per amount: one line, nothing left out, and not wider than its
     * tile (with softWrap = false it would otherwise run past the edge). Tiles of the same
     * row are equally high.
     */
    private fun valueTilesWhole(font: Float) {
        val market = fmtMoney(1712.4, CurrencyCode.CHF)
        val purchase = fmtMoney(1500.0, CurrencyCode.CHF)
        val pnl = fmtPercent(14.2)
        show(font) {
            Box(Modifier.width(360.dp).padding(horizontal = 16.dp)) {
                ValueTiles(market, purchase, 14.2)
            }
        }
        for (amount in listOf(market, purchase, pnl)) {
            val outcome = mutableListOf<TextLayoutResult>()
            compose.onNodeWithText(amount, useUnmergedTree = true).fetchSemanticsNode()
                .config.getOrNull(SemanticsActions.GetTextLayoutResult)?.action?.invoke(outcome)
            val t = outcome.single()
            assertEquals("$amount in einer Zeile", 1, t.lineCount)
            assertTrue("$amount ist abgeschnitten (rechts ${t.getLineRight(0)} von ${t.size.width})",
                !t.isLineEllipsized(0) && t.getLineEnd(0, visibleEnd = true) == amount.length &&
                    t.getLineRight(0) <= t.size.width + 0.5f)
        }
        val tiles = listOf(R.string.detail_section_market, R.string.detail_purchase_price, R.string.detail_pnl_tile)
            .map { compose.onNodeWithText(ctx.getString(it), substring = true).fetchSemanticsNode().boundsInRoot }
        tiles.groupBy { it.top }.values.filter { it.size > 1 }.forEach { series ->
            assertTrue("Kacheln einer Reihe gleich hoch: ${series.map { it.height }}",
                series.all { kotlin.math.abs(it.height - series[0].height) < 1f })
        }
    }

    @Test
    fun `value tiles show four-digit amounts fully on a narrow phone at 100 percent`() = valueTilesWhole(1f)

    @Test
    fun `value tiles show four-digit amounts fully on a narrow phone at 200 percent`() = valueTilesWhole(2f)

    @Test
    fun `purchase price at 200 percent stands below the label in one line`() {
        show(font = 2f) {
            Box(Modifier.width(360.dp)) {
                AcquisitionSummarySection(listOf(PurchaseView(id = 1, quantity = 1, purchasePrice = Money.from(700.0))), CurrencyCode.CHF) {}
            }
        }
        val amount = compose.onNodeWithText(fmtMoney(700.0, CurrencyCode.CHF), useUnmergedTree = true)
        assertEquals(1, rows(amount))
        val name = compose.onNodeWithText(ctx.getString(R.string.detail_purchase_price)).fetchSemanticsNode().boundsInRoot
        assertTrue("Der Betrag steht unter der Bezeichnung", amount.fetchSemanticsNode().boundsInRoot.top >= name.bottom)
    }
}
