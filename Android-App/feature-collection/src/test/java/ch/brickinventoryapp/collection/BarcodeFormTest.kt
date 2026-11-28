package ch.brickinventoryapp.collection

import ch.brickinventoryapp.ui.components.LocalAddressRules
import ch.brickinventoryapp.network.util.NetworkAddressRules
import androidx.compose.runtime.CompositionLocalProvider
import android.content.Context
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.test.core.app.ApplicationProvider
import ch.brickinventoryapp.collection.ui.BarcodeUiState
import ch.brickinventoryapp.collection.ui.dialogs.BarcodeDialogState
import ch.brickinventoryapp.collection.ui.dialogs.BarcodeResultDialog
import ch.brickinventoryapp.collection.ui.viewmodel.EntryActions
import ch.brickinventoryapp.model.domain.CurrencyCode
import ch.brickinventoryapp.model.domain.EntryRequest
import ch.brickinventoryapp.resources.R
import ch.brickinventoryapp.session.AppUiState
import ch.brickinventoryapp.state.ui.ScopeUiState
import ch.brickinventoryapp.state.ui.StorageUiState
import ch.brickinventoryapp.ui.theme.BrickInventoryManagerTheme
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/**
 * The barcode result form: quantity with the same −/+ stepper as the set page, and the
 * purchase price names the account's currency.
 *
 * Counter-checks (counter-checks/, measured with tools/counter-checks.py):
 *   barcode-stepper-ignored   plus no longer counts up → red “the stepper sets …” (1 instead of 3)
 *   barcode-without-currency  price field without the currency → red “the purchase price names …”
 *
 * A phone-sized screen: on Robolectric's 320×470 default the full dialog lays out at zero size
 * and taps on the stepper land nowhere.
 */
@RunWith(RobolectricTestRunner::class)
@Config(qualifiers = "w411dp-h891dp-port-xxhdpi")
class BarcodeFormTest {

    @get:Rule
    val compose = createComposeRule()

    private val ctx: Context = ApplicationProvider.getApplicationContext()

    private class Recorder : EntryActions {
        var wish: EntryRequest? = null
        override fun confirmAddBarcode(wish: EntryRequest) { this.wish = wish }
        override fun cancelBarcode() = Unit
        override fun cancelCheck() = Unit
    }

    private fun open(): Recorder {
        val actions = Recorder()
        val state = BarcodeDialogState(AppUiState(currency = CurrencyCode.CHF), ScopeUiState(),
            BarcodeUiState(result = "75192-1", setName = "Millennium Falcon"), StorageUiState())
        compose.setContent { CompositionLocalProvider(LocalAddressRules provides NetworkAddressRules) { 
            BrickInventoryManagerTheme { BarcodeResultDialog(state, actions, coil3.ImageLoader.Builder(ctx).build()) }
         }}
        compose.waitForIdle()
        return actions
    }

    @Test
    fun `the stepper sets the quantity that is added and never goes below one`() {
        val actions = open()
        val more = compose.onNodeWithContentDescription(ctx.getString(R.string.cd_qty_increase))
        compose.onNodeWithContentDescription(ctx.getString(R.string.cd_qty_decrease)).performClick()
        more.performClick(); more.performClick()
        compose.onNodeWithText("3", useUnmergedTree = true).assertExists()
        compose.onNodeWithText(ctx.getString(R.string.barcode_add)).performClick()
        compose.waitForIdle()
        assertEquals(3, actions.wish?.quantity)
    }

    @Test
    fun `the purchase price names the currency and what an empty field means`() {
        open()
        assertTrue("currency at the purchase price",
            compose.onAllNodesWithText("CHF", useUnmergedTree = true).fetchSemanticsNodes().isNotEmpty())
        compose.onNodeWithText(ctx.getString(R.string.common_unit_price_placeholder), useUnmergedTree = true).assertExists()
    }
}
