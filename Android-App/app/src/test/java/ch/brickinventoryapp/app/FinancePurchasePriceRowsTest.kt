package ch.brickinventoryapp.app

import android.content.Context
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.ui.test.hasScrollAction
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.performScrollToNode
import androidx.test.core.app.ApplicationProvider
import ch.brickinventoryapp.finances.ui.screens.FinanceRoute
import ch.brickinventoryapp.model.ui.theme.Design
import ch.brickinventoryapp.resources.R
import ch.brickinventoryapp.ui.theme.BrickInventoryManagerTheme
import org.junit.After
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode
import java.util.Locale

/**
 * The rows of the finance table show the same as on the web: the purchase price for sets AND
 * for manually added parts and figures. Drawn against the test server of the
 * sample world, with a part and a figure including purchase price.
 *
 * Counter-checks (patches under counter-checks/, Robolectric, measured by CI):
 *   finanz-manuelle-zeile-ohne-kauf  ManualFinanceRow does not show the purchase price → red “parts and figures …”
 *   finanz-teilzeile-ohne-kauf       the parts do not pass the purchase price through → red, the same test
 *   finanz-figurzeile-ohne-kauf      the figures do not pass it through → red, the same test
 *   finanz-setzeile-ohne-kauf        the set row does not show it → red “the set row …”
 */
@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(qualifiers = "de-rCH-w411dp-h891dp-port-xxhdpi")
class FinancePurchasePriceRowsTest {

    @get:Rule
    val compose = createComposeRule()

    private val ctx: Context = ApplicationProvider.getApplicationContext()
    private val before = Locale.getDefault()
    private val world = Examples.World(ContextTexts())

    init { Locale.setDefault(Locale.forLanguageTag("de-CH")) }

    @After
    fun tearDown() {
        Locale.setDefault(before)
        world.close()
    }

    private val purchasePrice by lazy { ctx.getString(R.string.finance_purchase_short, "").trim() }

    private fun show() {
        world.paths.responses["/api/v1/finance/parts-valuation"] = """{"success":true,"currency":"CHF","parts":[
            {"id":9,"part_number":"3001","part_name":"Brick 2 x 4","color_id":5,"quantity":1,"purchase_price":0.96,
             "avg_price":1.25,"wert_gesamt":1.25}],"total_value":"1.25"}"""
        world.paths.responses["/api/v1/finance/minifigs-valuation"] = """{"success":true,"currency":"CHF","figs":[
            {"id":3,"fig_number":"sw0001","fig_name":"Luke Skywalker","quantity":1,"purchase_price":4.35,
             "avg_price":6.5,"wert_gesamt":6.5}],"total_value":"6.50"}"""
        val vm = world.finances().also { it.loadValuation() }
        compose.setContent {
            BrickInventoryManagerTheme(theme = Design.CLASSIC) {
                Surface(color = MaterialTheme.colorScheme.background) {
                    FinanceRoute(vm = vm, imageLoader = coil3.ImageLoader.Builder(ctx).build())
                }
            }
        }
        driveUntil("Finanzen", ready = { vm.financeState.value.let { it.valuation != null && it.figsValuation != null } })
        compose.waitForIdle()
    }

    /** Scrolls to the row with [amount] and checks that the purchase price stands there. */
    private fun purchasePriceShown(amount: String) {
        val row = hasText(purchasePrice, substring = true) and hasText(amount, substring = true)
        // Next to the list the row of key figures scrolls too; whoever has the row is scrolled.
        val lists = compose.onAllNodes(hasScrollAction()).fetchSemanticsNodes().size
        val found = (0 until lists).any { i ->
            runCatching { compose.onAllNodes(hasScrollAction())[i].performScrollToNode(row) }.isSuccess
        }
        assertTrue("no row with “$purchasePrice … $amount”", found)
        compose.onNode(row, useUnmergedTree = true).fetchSemanticsNode()
    }

    @Test
    fun `parts and figures show their purchase price like the sets`() {
        show()
        purchasePriceShown("0.96")
        purchasePriceShown("4.35")
    }

    @Test
    fun `the set row still shows the purchase price`() {
        show()
        purchasePriceShown("700.00")
    }
}
