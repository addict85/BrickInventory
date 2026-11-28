package ch.brickinventoryapp.collection

import android.content.Intent
import android.net.Uri
import androidx.activity.ComponentActivity
import androidx.compose.ui.test.hasScrollToNodeAction
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.junit4.v2.createAndroidComposeRule
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollToNode
import ch.brickinventoryapp.collection.ui.BarcodeUiState
import ch.brickinventoryapp.collection.ui.SetDetailUiState
import ch.brickinventoryapp.collection.ui.dialogs.BarcodeDialogState
import ch.brickinventoryapp.collection.ui.dialogs.BarcodeResultDialog
import ch.brickinventoryapp.collection.ui.screens.SetDetailScreen
import ch.brickinventoryapp.collection.ui.screens.SetDetailState
import ch.brickinventoryapp.collection.ui.viewmodel.EntryActions
import ch.brickinventoryapp.collection.ui.viewmodel.SetDetailActions
import ch.brickinventoryapp.model.domain.AlarmDirection
import ch.brickinventoryapp.model.domain.Condition
import ch.brickinventoryapp.model.domain.EntryRequest
import ch.brickinventoryapp.model.domain.SetView
import ch.brickinventoryapp.model.file.FileRef
import ch.brickinventoryapp.model.ui.ScannerOrigin
import ch.brickinventoryapp.resources.R
import ch.brickinventoryapp.session.AppUiState
import ch.brickinventoryapp.state.ui.ScopeUiState
import ch.brickinventoryapp.state.ui.StorageUiState
import ch.brickinventoryapp.ui.theme.BrickInventoryManagerTheme
import coil3.ImageLoader
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config

/**
 * The price comparison left the bottom bar; it is an action where the set already is: the
 * set detail and the scan result. A tap opens toppreise.ch with the set in the browser.
 *
 * Counter-checks (patches under counter-checks/):
 *   detail-without-comparison     setDetailComparison() no longer called → red “the set detail opens …”
 *   scan-without-comparison       ScanComparison() no longer called → red “the scan result opens …”
 *   comparison-query-without-name setComparisonUrl() leaves out the name → red “the scan result opens …”
 */
@RunWith(RobolectricTestRunner::class)
@Config(qualifiers = "de-rCH")
class PriceComparisonActionTest {

    @get:Rule
    val compose = createAndroidComposeRule<ComponentActivity>()

    private val ctx get() = compose.activity
    private val compare get() = ctx.getString(R.string.detail_compare)

    private object NoEntry : EntryActions {
        override fun confirmAddBarcode(wish: EntryRequest) = Unit
        override fun cancelBarcode() = Unit
        override fun cancelCheck() = Unit
    }

    private object NoDetail : SetDetailActions {
        override fun refresh() = Unit
        override fun setPriceAlert(setNumber: String, direction: AlarmDirection, raw: String, condition: Condition) = Unit
        override fun changeQuantityBy(setNumber: String, step: Int) = Unit
        override fun setSetLocation(setNumber: String, location: String) = Unit
        override fun loadLocationStock(owner: List<Int>) = Unit
        override fun loadInstructionHigh(setNumber: String, file: FileRef) = Unit
        override fun deleteInstruction(setNumber: String, instrId: Int) = Unit
    }

    private fun scan(source: ScannerOrigin) {
        val state = BarcodeDialogState(AppUiState(), ScopeUiState(),
            BarcodeUiState(result = "75192-1", setName = "Millennium Falcon", source = source), StorageUiState())
        val images = ImageLoader.Builder(ctx).build()
        compose.setContent { BrickInventoryManagerTheme { BarcodeResultDialog(state, NoEntry, images) } }
        compose.waitForIdle()
    }

    /** The address the tap handed to the browser. */
    private fun opened(): String {
        val intent = shadowOf(ctx).nextStartedActivity
        assertNotNull("no browser was asked", intent)
        assertEquals(Intent.ACTION_VIEW, intent.action)
        return intent.data.toString()
    }

    @Test
    fun `the scan result opens the comparison for the scanned set`() {
        scan(ScannerOrigin.GALLERY)
        compose.onNodeWithText(compare).performClick()
        val url = Uri.parse(opened())
        assertEquals("www.toppreise.ch", url.host)
        assertEquals("LEGO 75192 Millennium Falcon", url.getQueryParameter("q"))
    }

    @Test
    fun `a scan for the parts list offers no comparison`() {
        scan(ScannerOrigin.PART_LIST)
        assertEquals(0, compose.onAllNodesWithText(compare).fetchSemanticsNodes().size)
    }

    @Test
    fun `the set detail opens the comparison the server named`() {
        val falcon = SetView("75192-1", name = "Millennium Falcon",
            priceComparisonUrl = "https://www.toppreise.ch/produktsuche?q=LEGO+75192+Millennium+Falcon")
        val condition = SetDetailState(AppUiState(), SetDetailUiState(setDetail = falcon), StorageUiState())
        val images = ImageLoader.Builder(ctx).build()
        compose.setContent {
            BrickInventoryManagerTheme {
                SetDetailScreen(setNumber = "75192-1", condition = condition, actions = NoDetail,
                    serverUrl = "", imageLoader = images, onBack = {}, onDelete = {})
            }
        }
        compose.waitForIdle()
        compose.onNode(hasScrollToNodeAction()).performScrollToNode(hasText(compare))
        compose.onNodeWithText(compare).performClick()
        assertEquals(falcon.priceComparisonUrl, opened())
    }
}
