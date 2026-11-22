package ch.brickinventoryapp.app

import android.content.Context
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.runtime.Composable
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.onAllNodesWithText
import androidx.test.core.app.ApplicationProvider
import ch.brickinventoryapp.app.testing.Examples
import ch.brickinventoryapp.app.testing.TestApp
import ch.brickinventoryapp.collection.ui.screens.AcquisitionManagementRoute
import ch.brickinventoryapp.model.domain.CurrencyCode
import ch.brickinventoryapp.model.domain.ItemKind
import ch.brickinventoryapp.model.ui.theme.Design
import ch.brickinventoryapp.parts.ui.screens.MinifigsRoute
import ch.brickinventoryapp.resources.R
import ch.brickinventoryapp.ui.theme.BrickInventoryManagerTheme
import ch.brickinventoryapp.ui.util.fmtMoney
import org.junit.After
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/**
 * The surfaces display the server's totals instead of adding up a list that may be filtered or
 * paged: the purchases' total row and the three figure tiles show numbers no list sum gives.
 *
 * Counter-checks (run here):
 *   the total row gets `quantity = acquisitions.sumOf { it.quantity }` in AcquisitionManagementScreen → red
 *   “the purchases' total row …”; `totals.amount?.let` → `(totals.amount ?: 0).let` → red, the same test;
 *   MinifigsMetrics gets `minifigStats.copy(types = figs.size)` in MinifigsScreen → red “the figure tiles …”.
 */
@RunWith(RobolectricTestRunner::class)
@Config(qualifiers = "w411dp-h891dp-port-xxhdpi")
class ServerTotalsDisplayTest {

    @get:Rule
    val compose = createComposeRule()

    private val ctx: Context = ApplicationProvider.getApplicationContext()
    private val world = Examples.World(ContextTexts())

    @After fun tearDown() = world.close()

    private fun show(content: @Composable () -> Unit) {
        compose.setContent {
            BrickInventoryManagerTheme(theme = Design.CLASSIC) { Surface(color = MaterialTheme.colorScheme.background) { content() } }
        }
        driveUntil("screen", { world.paths.requests.size }) { true }
        compose.waitForIdle()
    }

    private fun shown(text: String) = compose.onAllNodesWithText(text, useUnmergedTree = true).fetchSemanticsNodes().isNotEmpty()

    @Test
    fun `the purchases' total row shows the server's total and no amount where none was recorded`() {
        world.paths.responses["/api/v1/sets/75192-1/acquisitions"] = """{"success":true,"acquisitions":[
            {"id":1,"quantity":1,"condition":"N","currency":"CHF","created_at":"2026-03-14T10:00:00Z"},
            {"id":2,"quantity":2,"condition":"N","currency":"CHF","created_at":"2026-04-14T10:00:00Z"}],
            "totals":{"quantity":7,"amount":null,"priced_rows":0}}"""
        val vm = world.purchases()
        show { AcquisitionManagementRoute(vm, ItemKind.SET, "75192-1", title = "Millennium Falcon", onBack = {}) }
        assertTrue("not the server's total", shown(ctx.getString(R.string.acq_total_quantity, 7)))
        assertFalse("the sum of the rows", shown(ctx.getString(R.string.acq_total_quantity, 3)))
        assertFalse("“nothing recorded” shown as an amount of 0", shown(fmtMoney(0.0, CurrencyCode.CHF)))
    }

    @Test
    fun `the figure tiles show the server's numbers, not the list's`() {
        world.paths.responses["/api/v1/minifigs/stats"] = """{"success":true,"stats":{"types":11,"total_quantity":40,"manual":5}}"""
        val vm = world.figures().also { it.loadMinifigs() }
        show { MinifigsRoute(vm = vm, imageLoader = TestApp.noImages(ctx)) }
        for ((id, n) in listOf(R.plurals.minifigs_stat_types to 11, R.plurals.minifigs_stat_total to 40, R.plurals.minifigs_stat_manual to 5)) {
            val text = ctx.resources.getQuantityString(id, n, "$n")
            assertTrue("“$text” missing", shown(text))
        }
    }
}
