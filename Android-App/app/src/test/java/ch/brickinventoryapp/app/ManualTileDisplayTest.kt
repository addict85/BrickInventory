package ch.brickinventoryapp.app

import android.content.Context
import android.os.Looper
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.runtime.Composable
import androidx.compose.ui.test.ComposeTimeoutException
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onNodeWithText
import androidx.test.core.app.ApplicationProvider
import ch.brickinventoryapp.app.testing.Examples
import ch.brickinventoryapp.model.domain.CurrencyCode
import ch.brickinventoryapp.model.ui.theme.Design
import ch.brickinventoryapp.parts.ui.screens.MinifigsRoute
import ch.brickinventoryapp.parts.ui.screens.PartsRoute
import ch.brickinventoryapp.resources.R
import ch.brickinventoryapp.ui.theme.BrickInventoryManagerTheme
import ch.brickinventoryapp.ui.util.fmtMoney
import org.junit.After
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode
import java.util.Locale

/**
 * The tiles of manually added parts and figures show the same as the web app:
 * every added condition, the owners in the household and the quantity-weighted
 * purchase price before the most recently written one. Drawn from responses of the test server
 * so that passing the fields into each of the two tiles is checked too.
 *
 * Counter-checks (patches under counter-checks/, Robolectric, measured by CI):
 *   kachel-teil-ohne-besitzer       ManualPartTile does not pass on the owners → red “the manual part shows …”
 *   kachel-figur-ohne-zustaende     ManualFigTile does not pass on the conditions → red “the manual figure shows …”
 *   kachel-preis-zuletzt-geschrieben  unit_price before avg_purchase_price → red “the manual part shows …”
 *   figuren-kennzahlen-an-liste     the figures' key figures hang on the set list → red “the key figures …”
 */
@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(qualifiers = "de-rCH-w411dp-h891dp-port-xxhdpi")
class ManualTileDisplayTest {

    @get:Rule
    val compose = createComposeRule()

    private val before = Locale.getDefault()
    private val ctx: Context = ApplicationProvider.getApplicationContext()
    private val images = SampleImages.loader(ctx)
    private val world = Examples.World(ContextTexts())

    init { Locale.setDefault(Locale.forLanguageTag("de-CH")) }

    @After
    fun tearDown() {
        Locale.setDefault(before)
        world.close()
    }

    private fun show(content: @Composable () -> Unit) {
        compose.setContent {
            BrickInventoryManagerTheme(theme = Design.CLASSIC) {
                Surface(color = MaterialTheme.colorScheme.background) { content() }
            }
        }
        compose.waitForIdle()
    }

    private fun wait(was: String, ready: () -> Boolean) {
        try {
            compose.waitUntil(10_000) { shadowOf(Looper.getMainLooper()).idle(); ready() }
        } catch (e: ComposeTimeoutException) {
            throw AssertionError("$was: not there after 10 s", e)
        }
        compose.waitForIdle()
    }

    /** Conditions, owners and both prices: averaged 5.–, most recently written 8.–. */
    private val fields = """"quantity":4,"unit_price":8.0,"avg_purchase_price":5.0,"condition":"U","conditions":["N","U"],""" +
        """"owners":[{"id":2,"username":"Anna"},{"id":3,"username":"Beat"}]"""

    private fun showsEverything(who: String) {
        for (text in listOf(ctx.getString(R.string.condition_new), ctx.getString(R.string.condition_used), "Anna", "Beat")) {
            assertTrue("$who does not show “$text”",
                compose.onAllNodesWithText(text, useUnmergedTree = true).fetchSemanticsNodes().isNotEmpty())
        }
        val price = fmtMoney(5.0, CurrencyCode("CHF"))
        assertTrue("$who does not show the averaged purchase price $price",
            compose.onAllNodesWithText(price, useUnmergedTree = true).fetchSemanticsNodes().isNotEmpty())
    }

    @Test
    fun `the manual part shows conditions, owners and the averaged purchase price`() {
        world.paths.responses["/api/v2/parts/manual"] =
            """{"success":true,"parts":[{"id":7,"part_number":"3005","part_name":"Brick 1 x 1","color_id":1,$fields}]}"""
        val vm = world.parts().also { it.loadParts() }
        wait("parts") { !vm.partsState.value.manualParts.isNullOrEmpty() }
        show { PartsRoute(vm = vm, imageLoader = images) }
        compose.onNodeWithText("Brick 1 x 1", useUnmergedTree = true).fetchSemanticsNode()
        showsEverything("Teil")
    }

    @Test
    fun `the manual figure shows conditions, owners and the averaged purchase price`() {
        world.paths.responses["/api/v2/minifigs/manual"] =
            """{"success":true,"figs":[{"id":8,"fig_number":"sw0100","fig_name":"Prinzessin Leia",$fields}]}"""
        val vm = world.figures().also { it.loadMinifigs() }
        wait("figures") { !vm.minifigsState.value.manualFigs.isNullOrEmpty() }
        show { MinifigsRoute(vm = vm, imageLoader = images) }
        compose.onNodeWithText("Prinzessin Leia", useUnmergedTree = true).fetchSemanticsNode()
        showsEverything("Figur")
    }

    @Test
    fun `the key figures of the figures stay, even without figures from sets`() {
        // They mean the whole collection (/minifigs/stats), not the loaded list.
        world.paths.responses["/api/v2/minifigs"] = """{"success":true,"figs":[]}"""
        world.paths.responses["/api/v2/minifigs/manual"] =
            """{"success":true,"figs":[{"id":8,"fig_number":"sw0100","fig_name":"Prinzessin Leia","quantity":1}]}"""
        val vm = world.figures().also { it.loadMinifigs() }
        wait("figures") { vm.minifigsState.value.let { !it.manualFigs.isNullOrEmpty() && it.minifigStats.types > 0 } }
        show { MinifigsRoute(vm = vm, imageLoader = images) }
        compose.onNodeWithText("Prinzessin Leia", useUnmergedTree = true).fetchSemanticsNode()
        val types = ctx.resources.getQuantityString(R.plurals.minifigs_stat_types, 2, "2")
        assertTrue("the figures “$types” are missing",
            compose.onAllNodesWithText(types, useUnmergedTree = true).fetchSemanticsNodes().isNotEmpty())
    }
}
