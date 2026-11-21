package ch.brickinventoryapp.app

import ch.brickinventoryapp.model.ui.theme.Design
import android.content.Context
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.ui.test.hasScrollAction
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.performScrollToNode
import androidx.test.core.app.ApplicationProvider
import ch.brickinventoryapp.finances.ui.screens.FinanceRoute
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
 * Counter-checks (patches under gegenproben/, Robolectric, measured by CI):
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
    private val vorher = Locale.getDefault()
    private val world = Examples.Welt(ContextTexts())

    init { Locale.setDefault(Locale.forLanguageTag("de-CH")) }

    @After
    fun zu() {
        Locale.setDefault(vorher)
        world.close()
    }

    private val kaufpreis by lazy { ctx.getString(R.string.finance_purchase_short, "").trim() }

    private fun zeige() {
        world.paths.antworten["/api/v1/finance/parts-valuation"] = """{"success":true,"currency":"CHF","parts":[
            {"id":9,"part_number":"3001","part_name":"Brick 2 x 4","color_id":5,"quantity":1,"purchase_price":0.96,
             "avg_price":1.25,"wert_gesamt":1.25}],"total_value":"1.25"}"""
        world.paths.antworten["/api/v1/finance/minifigs-valuation"] = """{"success":true,"currency":"CHF","figs":[
            {"id":3,"fig_number":"sw0001","fig_name":"Luke Skywalker","quantity":1,"purchase_price":4.35,
             "avg_price":6.5,"wert_gesamt":6.5}],"total_value":"6.50"}"""
        val vm = world.finanzen().also { it.loadValuation() }
        compose.setContent {
            BrickInventoryManagerTheme(theme = Design.CLASSIC) {
                Surface(color = MaterialTheme.colorScheme.background) {
                    FinanceRoute(vm = vm, imageLoader = coil3.ImageLoader.Builder(ctx).build())
                }
            }
        }
        driveUntil("Finanzen", bereit = { vm.financeState.value.let { it.valuation != null && it.figsValuation != null } })
        compose.waitForIdle()
    }

    /** Scrolls to the row with [betrag] and checks that the purchase price stands there. */
    private fun purchasePriceStands(betrag: String) {
        val zeile = hasText(kaufpreis, substring = true) and hasText(betrag, substring = true)
        // Next to the list the row of key figures scrolls too; whoever has the row is scrolled.
        val listen = compose.onAllNodes(hasScrollAction()).fetchSemanticsNodes().size
        val gefunden = (0 until listen).any { i ->
            runCatching { compose.onAllNodes(hasScrollAction())[i].performScrollToNode(zeile) }.isSuccess
        }
        assertTrue("Keine Zeile mit „$kaufpreis … $betrag“", gefunden)
        compose.onNode(zeile, useUnmergedTree = true).fetchSemanticsNode()
    }

    @Test
    fun `parts and figures show their purchase price like the sets`() {
        zeige()
        purchasePriceStands("0.96")
        purchasePriceStands("4.35")
    }

    @Test
    fun `the set row still shows the purchase price`() {
        zeige()
        purchasePriceStands("700.00")
    }
}
