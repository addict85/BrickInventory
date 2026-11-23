package ch.brickinventoryapp.app

import android.content.Context
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.ui.test.hasScrollToNodeAction
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.performScrollToNode
import androidx.test.core.app.ApplicationProvider
import ch.brickinventoryapp.app.testing.Examples
import ch.brickinventoryapp.data.testing.testFinancesRepository
import ch.brickinventoryapp.data.testing.testHouseholdRepository
import ch.brickinventoryapp.data.testing.testMinifigsRepository
import ch.brickinventoryapp.data.testing.testPartsRepository
import ch.brickinventoryapp.model.domain.CurrencyCode
import ch.brickinventoryapp.model.domain.ItemKind
import ch.brickinventoryapp.model.ui.theme.Design
import ch.brickinventoryapp.parts.ui.PartsTarget
import ch.brickinventoryapp.parts.ui.screens.ManualItemDetailRoute
import ch.brickinventoryapp.resources.R
import ch.brickinventoryapp.state.ui.viewmodel.PurchasesViewModel
import ch.brickinventoryapp.ui.theme.BrickInventoryManagerTheme
import ch.brickinventoryapp.ui.util.fmtMoney
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/**
 * The detail of a self-entered part shows the value tiles, the market price per condition and
 * the price history, and does not repeat the market price in a large row of its own.
 *
 * Counter-checks (local, Robolectric):
 *   `item { ManualValueTiles(entry, currency) }` removed         → red “value tiles …”
 *   `MarketPriceByCondition(it, currency)` removed               → red “market price per condition …”
 *   `PriceChart(it, currency)` removed                           → red “price history …”
 *   a `Text(market, style = headlineSmall)` above the tiles      → red “the market price stands once …”
 */
@RunWith(RobolectricTestRunner::class)
@Config(qualifiers = "de-rCH-w1000dp-h900dp-land")
class ManualItemDetailDisplayTest {

    @get:Rule
    val compose = createComposeRule()

    private val ctx: Context = ApplicationProvider.getApplicationContext()
    private val world = Examples.World(ContextTexts())

    @After
    fun tearDown() = world.close()

    private fun count(text: String) = compose.onAllNodes(hasText(text, substring = true), useUnmergedTree = true)
        .fetchSemanticsNodes().size

    private fun purchases() = world.t.track(PurchasesViewModel(world.t.session, world.t.filter(), world.t.hints, world.t.changes,
        testHouseholdRepository(world.t.api), world.t.sets(), testFinancesRepository(world.t.api), testPartsRepository(world.t.api),
        testMinifigsRepository(world.t.api)))

    @Test
    fun `the detail view shows value tiles, market price and price history, without a large price row`() {
        world.paths.responses["/api/v2/parts/manual"] = """{"success":true,"parts":[{"id":9,"part_number":"3001",
            "part_name":"Brick 2 x 4","color_id":5,"color_name":"Red","quantity":12,"avg_price":0.37,"purchase_price":0.25}]}"""
        world.paths.responses["/api/v2/parts/3001/5/price-history"] = """{"success":true,"currency":"CHF",
            "by_condition":{"N":{"market_price":0.41,"purchase_price":0.25}},
            "chart":{"values":[{"name":"N","values":[{"x":"2026-08-01","y":0.33},{"x":"2026-09-01","y":0.35},{"x":"2026-10-01","y":0.41}],"firstRealIndex":0}],
                     "x":["2026-08-01","2026-09-01","2026-10-01"]}}"""
        val parts = world.parts().also { it.loadParts() }
        driveUntil("parts", requests = { world.paths.requests.size }) { parts.partsState.value.manualParts?.isNotEmpty() == true }
        val vm = purchases()
        compose.setContent {
            BrickInventoryManagerTheme(theme = Design.CLASSIC) {
                Surface(color = MaterialTheme.colorScheme.background) {
                    ManualItemDetailRoute(vm, parts, world.figures(), item = PartsTarget.ManualItemDetail(ItemKind.PART, "3001", 5, "Brick 2 x 4"),
                        imageLoader = SampleImages.loader(ctx), onBack = {}, onNavigateToAcqMgmt = { _, _, _, _ -> })
                }
            }
        }
        val history = ctx.getString(R.string.price_chart_low_high, fmtMoney(0.33, CurrencyCode.CHF), fmtMoney(0.41, CurrencyCode.CHF))
        driveUntil("price history", requests = { world.paths.requests.size }) {
            compose.waitForIdle()
            val areas = compose.onAllNodes(hasScrollToNodeAction())
            areas.fetchSemanticsNodes().indices.any { i -> runCatching { areas[i].performScrollToNode(hasText(history)) }.isSuccess }
        }
        assertEquals("price history", 1, count(history))
        val market = ctx.getString(R.string.detail_section_market)
        assertEquals("market price per condition", 1, count("$market (${ctx.getString(R.string.condition_new)})"))
        assertEquals("value tiles", 1, count(ctx.getString(R.string.detail_pnl_tile)))
        assertEquals("the market price stands once, in its tile", 1, count(fmtMoney(0.37, CurrencyCode.CHF)))
    }
}
