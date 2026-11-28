package ch.brickinventoryapp.collection

import android.content.Context
import androidx.compose.ui.test.hasContentDescription
import androidx.compose.ui.test.hasSetTextAction
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.test.core.app.ApplicationProvider
import ch.brickinventoryapp.collection.ui.BarcodeUiState
import ch.brickinventoryapp.collection.ui.dialogs.BarcodeDialogState
import ch.brickinventoryapp.collection.ui.dialogs.BarcodeResultDialog
import ch.brickinventoryapp.collection.ui.viewmodel.EntryActions
import ch.brickinventoryapp.model.domain.Condition
import ch.brickinventoryapp.model.domain.EntryRequest
import ch.brickinventoryapp.model.ui.ScannerOrigin
import ch.brickinventoryapp.resources.R
import ch.brickinventoryapp.session.AppUiState
import ch.brickinventoryapp.state.ui.ScopeUiState
import ch.brickinventoryapp.state.ui.StorageUiState
import ch.brickinventoryapp.ui.theme.BrickInventoryManagerTheme
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

/**
 * The barcode dialog from the parts list shows no entry fields and passes only the number;
 * from the gallery it asks for quantity, purchase price and condition. The image stays in
 * both cases: it is how one checks that the right set was scanned.
 *
 * Counter-check (run here): the condition `if (barcodeState.source != ScannerOrigin.PART_LIST)`
 * around the fields removed → red “from the parts list only the image and the number …”.
 * Counter-check (run here): the part list branch of onConfirm sends the full request → red
 * “from the parts list only the image and the number …” (quantity and condition sent).
 */
@RunWith(RobolectricTestRunner::class)
class BarcodeDialogOriginTest {

    @get:Rule
    val compose = createComposeRule()

    private val ctx: Context = ApplicationProvider.getApplicationContext()

    private class Recorder : EntryActions {
        var wish: EntryRequest? = null
        override fun confirmAddBarcode(wish: EntryRequest) { this.wish = wish }
        override fun cancelBarcode() = Unit
        override fun cancelCheck() = Unit
    }

    private fun show(source: ScannerOrigin): Recorder {
        val actions = Recorder()
        val state = BarcodeDialogState(AppUiState(), ScopeUiState(),
            BarcodeUiState(result = "75192-1", setName = "Millennium Falcon", imageUrl = "https://example.org/75192-1.png",
                source = source), StorageUiState())
        val images = coil3.ImageLoader.Builder(ctx).build()
        compose.setContent { BrickInventoryManagerTheme { BarcodeResultDialog(state, actions, images) } }
        compose.waitForIdle()
        return actions
    }

    private fun fieldCount(label: Int) =
        compose.onAllNodes(hasSetTextAction() and hasText(ctx.getString(label))).fetchSemanticsNodes().size

    private fun stepperCount() =
        compose.onAllNodes(hasContentDescription(ctx.getString(R.string.cd_qty_increase))).fetchSemanticsNodes().size

    private fun confirm(actions: Recorder): EntryRequest? {
        compose.onNodeWithText(ctx.getString(R.string.barcode_add)).performClick()
        compose.waitForIdle()
        return actions.wish
    }

    @Test
    fun `from the parts list only the image and the number count`() {
        val actions = show(ScannerOrigin.PART_LIST)
        compose.onNodeWithContentDescription("Millennium Falcon").fetchSemanticsNode("image missing")
        assertEquals("purchase price field", 0, fieldCount(R.string.barcode_purchase_price))
        assertEquals("quantity stepper", 0, stepperCount())
        assertEquals(EntryRequest("75192-1"), confirm(actions))
    }

    @Test
    fun `from the gallery quantity, purchase price and condition are asked for`() {
        val actions = show(ScannerOrigin.GALLERY)
        compose.onNodeWithContentDescription("Millennium Falcon").fetchSemanticsNode("image missing")
        assertEquals("purchase price field", 1, fieldCount(R.string.barcode_purchase_price))
        assertEquals("quantity stepper", 1, stepperCount())
        assertEquals(EntryRequest("75192-1", quantity = 1, condition = Condition.NEW), confirm(actions))
    }
}
