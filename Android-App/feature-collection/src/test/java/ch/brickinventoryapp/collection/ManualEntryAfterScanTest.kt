package ch.brickinventoryapp.collection

import android.content.Context
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.test.core.app.ApplicationProvider
import ch.brickinventoryapp.collection.ui.BarcodeUiState
import ch.brickinventoryapp.collection.ui.GalleryUiState
import ch.brickinventoryapp.collection.ui.screens.GalleryEvents
import ch.brickinventoryapp.collection.ui.screens.GalleryScreen
import ch.brickinventoryapp.collection.ui.screens.GalleryState
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
 * An unsuccessful scan leads to manual adding: the gallery opens its add dialog and
 * acknowledges the request. The build list's counterpart is checked in SubpagesTest.
 *
 * Counter-check (run here): `showAddDialog = true` removed from the LaunchedEffect in
 * GalleryScreen → red “after an unsuccessful scan the gallery opens …”.
 * Counter-check (run here): `events.manualEntryAcknowledged()` removed → red, the same test.
 */
@RunWith(RobolectricTestRunner::class)
class ManualEntryAfterScanTest {

    @get:Rule
    val compose = createComposeRule()

    private val ctx: Context = ApplicationProvider.getApplicationContext()

    @Test
    fun `after an unsuccessful scan the gallery opens its add dialog and acknowledges`() {
        var acknowledged = 0
        val events = GalleryEvents(search = {}, theme = {}, sorting = {}, account = {}, storageLocation = {},
            refresh = {}, setRecord = {}, manualEntryAcknowledged = { acknowledged++ })
        val state = GalleryState(AppUiState(), ScopeUiState(), GalleryUiState(), emptyMap(),
            BarcodeUiState(requestManualEntry = true), StorageUiState())
        val images = coil3.ImageLoader.Builder(ctx).build()
        compose.setContent {
            BrickInventoryManagerTheme { GalleryScreen(state, events, images, onScanBarcode = {}, onSetClick = {}) }
        }
        compose.waitForIdle()
        compose.onNodeWithText(ctx.getString(R.string.gallery_add_set_title)).fetchSemanticsNode("add dialog not open")
        assertEquals("acknowledged once", 1, acknowledged)
    }
}
