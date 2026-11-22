package ch.brickinventoryapp.collection

import android.content.Context
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.test.hasScrollToNodeAction
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.onAllNodesWithContentDescription
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onFirst
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollToNode
import androidx.test.core.app.ApplicationProvider
import ch.brickinventoryapp.collection.ui.SetDetailUiState
import ch.brickinventoryapp.collection.ui.screens.SetDetailScreen
import ch.brickinventoryapp.collection.ui.screens.SetDetailState
import ch.brickinventoryapp.collection.ui.viewmodel.SetDetailActions
import ch.brickinventoryapp.model.domain.AlarmDirection
import ch.brickinventoryapp.model.domain.Condition
import ch.brickinventoryapp.model.domain.CurrencyCode
import ch.brickinventoryapp.model.domain.Money
import ch.brickinventoryapp.model.domain.SetPriceView
import ch.brickinventoryapp.model.domain.SetView
import ch.brickinventoryapp.model.file.FileRef
import ch.brickinventoryapp.model.ui.ErrorClass
import ch.brickinventoryapp.model.ui.Load
import ch.brickinventoryapp.model.ui.Message
import ch.brickinventoryapp.model.ui.theme.Design
import ch.brickinventoryapp.resources.R
import ch.brickinventoryapp.session.AppUiState
import ch.brickinventoryapp.state.ui.StorageUiState
import ch.brickinventoryapp.ui.theme.BrickInventoryManagerTheme
import ch.brickinventoryapp.ui.util.fmtMoney
import coil3.ImageLoader
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/**
 * The set detail, rendered with a fixed state: purchase price, market price and quantity slider,
 * as the user sees them. Replaces the source checks in PurchasePriceDisplayTest
 * and ServerComputedValuesTest (core-data read screens from feature-collection for that).
 *
 * Counter-checks (Robolectric, measurable only in the CI; patches under counter-checks/):
 *   kaufkachel-letzter-kauf     the purchase-price tile shows maxPurchasePrice → red “the purchase price tile …”
 *   marktpreis-doppelt          the price card shows the market price again → red “the market price …”
 *   mengenregler-ohne-kopplung  `remember(set.setNumber)` without set.quantity → red “the quantity slider …”
 *   verlauf-fehler-ohne-klasse  ErrorHint of the price history without historyFetch.art → red “if the price history fails …”
 */
@RunWith(RobolectricTestRunner::class)
@Config(qualifiers = "de-rCH-w1000dp-h900dp-land")
class SetDetailDisplayTest {

    @get:Rule
    val compose = createComposeRule()

    private val ctx: Context = ApplicationProvider.getApplicationContext()

    private class Actions : SetDetailActions {
        val steps = mutableListOf<Int>()
        override fun refresh() = Unit
        override fun setPriceAlert(setNumber: String, direction: AlarmDirection, raw: String, condition: Condition) = Unit
        override fun changeQuantityBy(setNumber: String, step: Int) { steps += step }
        override fun setSetLocation(setNumber: String, location: String) = Unit
        override fun loadLocationStock(owner: List<Int>) = Unit
        override fun loadInstructionHigh(setNumber: String, file: FileRef) = Unit
        override fun deleteInstruction(setNumber: String, instrId: Int) = Unit
    }

    private val falcon = SetView("75192-1", name = "Millennium Falcon", quantity = 5,
        avgPurchasePrice = Money.from(712.5), maxPurchasePrice = Money.from(800.0))
    private val price = SetPriceView("75192-1", CurrencyCode.CHF, avgPrice = Money.from(1249.9))

    private fun condition(set: SetView) = SetDetailState(AppUiState(currency = CurrencyCode.CHF),
        SetDetailUiState(setDetail = set, setPrice = price), StorageUiState())

    private fun count(text: String) = compose.onAllNodesWithText(text, useUnmergedTree = true).fetchSemanticsNodes().size

    @Test
    fun `the purchase price tile shows the quantity-weighted average, not the last purchase`() {
        val images = ImageLoader.Builder(ctx).build()
        compose.setContent {
            BrickInventoryManagerTheme(theme = Design.CLASSIC) {
                SetDetailScreen(setNumber = "75192-1", condition = condition(falcon), actions = Actions(),
                    serverUrl = "", imageLoader = images, onBack = {}, onDelete = {})
            }
        }
        compose.waitForIdle()
        assertEquals(1, count(fmtMoney(712.5, CurrencyCode.CHF)))
        assertEquals(0, count(fmtMoney(800.0, CurrencyCode.CHF)))
    }

    @Test
    fun `the market price appears once in the value tiles, not again in the price card`() {
        val images = ImageLoader.Builder(ctx).build()
        compose.setContent {
            BrickInventoryManagerTheme(theme = Design.CLASSIC) {
                SetDetailScreen(setNumber = "75192-1", condition = condition(falcon), actions = Actions(),
                    serverUrl = "", imageLoader = images, onBack = {}, onDelete = {})
            }
        }
        compose.waitForIdle()
        // The price card is there (its title stands next to the tile's), but does not repeat the amount.
        assertEquals(2, count(ctx.getString(R.string.detail_section_market)))
        assertEquals(1, count(fmtMoney(1249.9, CurrencyCode.CHF)))
    }

    @Test
    fun `the quantity control follows the quantity the server returns`() {
        val images = ImageLoader.Builder(ctx).build()
        val actions = Actions()
        var set by mutableStateOf(falcon)
        compose.setContent {
            BrickInventoryManagerTheme(theme = Design.CLASSIC) {
                SetDetailScreen(setNumber = "75192-1", condition = condition(set), actions = actions,
                    serverUrl = "", imageLoader = images, onBack = {}, onDelete = {})
            }
        }
        compose.waitForIdle()
        compose.onAllNodesWithContentDescription(ctx.getString(R.string.cd_qty_decrease)).onFirst().performClick()
        compose.waitForIdle()
        assertEquals(listOf(-1), actions.steps)
        assertEquals("der Regler zählt sofort", 1, count("4"))
        // Someone else's copies cannot be taken away: the server caps it and reports 3.
        set = falcon.copy(quantity = 3)
        compose.waitForIdle()
        assertEquals(1, count("3"))
        assertEquals(0, count("4"))
    }

    @Test
    fun `if the price history fails, the advice of its error class is shown`() {
        val images = ImageLoader.Builder(ctx).build()
        val withoutNetwork = SetDetailState(AppUiState(currency = CurrencyCode.CHF),
            SetDetailUiState(setDetail = falcon, setPrice = price,
                historyFetch = Load.Failure(ErrorClass.OFFLINE, Message.Text("Zeitüberschreitung"))), StorageUiState())
        compose.setContent {
            BrickInventoryManagerTheme(theme = Design.CLASSIC) {
                SetDetailScreen(setNumber = "75192-1", condition = withoutNetwork, actions = Actions(),
                    serverUrl = "", imageLoader = images, onBack = {}, onDelete = {})
            }
        }
        compose.waitForIdle()
        val advice = ctx.getString(R.string.error_offline_text)
        // The price card sits at the bottom of the list; which scroll range it carries depends on the width.
        val areas = compose.onAllNodes(hasScrollToNodeAction())
        for (i in areas.fetchSemanticsNodes().indices) {
            try { areas[i].performScrollToNode(hasText(advice)); break } catch (_: AssertionError) { continue }
        }
        assertEquals("Ohne Klasse stand nur „Laden fehlgeschlagen“", 1, count(advice))
    }
}
