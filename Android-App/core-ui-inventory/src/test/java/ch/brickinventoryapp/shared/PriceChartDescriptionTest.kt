package ch.brickinventoryapp.shared

import android.content.Context
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.ui.test.hasContentDescription
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.test.core.app.ApplicationProvider
import ch.brickinventoryapp.model.domain.CurrencyCode
import ch.brickinventoryapp.model.domain.Money
import ch.brickinventoryapp.model.domain.PriceChartView
import ch.brickinventoryapp.model.domain.PricePointView
import ch.brickinventoryapp.model.domain.PriceSeriesView
import ch.brickinventoryapp.model.ui.theme.Design
import ch.brickinventoryapp.resources.R
import ch.brickinventoryapp.shared.ui.PriceChart
import ch.brickinventoryapp.ui.theme.BrickInventoryManagerTheme
import ch.brickinventoryapp.ui.util.fmtAmount
import org.junit.After
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode
import java.util.Locale

/**
 * The price chart in the set detail is not an empty canvas for TalkBack: its drawing
 * carries a description with condition, start, end, low and high of every line.
 *
 * Counter-check (counter-checks/price-chart-silent.patch, Robolectric, measured by CI): the
 * semantics removed from the canvas → red „das Preisdiagramm beschreibt …“.
 */
@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(qualifiers = "de-rCH-w411dp-h891dp-port-xxhdpi")
class PriceChartDescriptionTest {

    @get:Rule
    val compose = createComposeRule()

    private val ctx: Context = ApplicationProvider.getApplicationContext()
    private val before = Locale.getDefault()

    init { Locale.setDefault(Locale.forLanguageTag("de-CH")) }

    @After
    fun tearDown() = Locale.setDefault(before)

    @Test
    fun `the price chart describes its line in words`() {
        val history = PriceChartView(values = listOf(PriceSeriesView("N",
            listOf(PricePointView("2026-01-01", Money.from(710.0)!!), PricePointView("2026-02-01", Money.from(690.0)!!), PricePointView("2026-03-01", Money.from(730.0)!!)))))
        compose.setContent {
            BrickInventoryManagerTheme(theme = Design.CLASSIC) {
                Surface(color = MaterialTheme.colorScheme.background) { PriceChart(history, CurrencyCode("CHF")) }
            }
        }
        compose.waitForIdle()
        val newValue = ctx.getString(R.string.condition_new)
        compose.onNode(hasContentDescription(newValue, substring = true) and hasContentDescription(fmtAmount(690.0), substring = true)
            and hasContentDescription(fmtAmount(730.0), substring = true)).fetchSemanticsNode()
    }
}
