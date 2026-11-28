package ch.brickinventoryapp.collection

import android.content.Context
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.test.core.app.ApplicationProvider
import ch.brickinventoryapp.collection.ui.BarcodeUiState
import ch.brickinventoryapp.collection.ui.dialogs.BarcodeDialogState
import ch.brickinventoryapp.collection.ui.dialogs.BarcodeResultDialog
import ch.brickinventoryapp.collection.ui.screens.AddSetDialog
import ch.brickinventoryapp.collection.ui.screens.AdoptionDialog
import ch.brickinventoryapp.collection.ui.viewmodel.EntryActions
import ch.brickinventoryapp.model.domain.EntryRequest
import ch.brickinventoryapp.model.domain.LocationEntryView
import ch.brickinventoryapp.model.domain.MemberView
import ch.brickinventoryapp.model.domain.WantedItemView
import ch.brickinventoryapp.network.util.NetworkAddressRules
import ch.brickinventoryapp.resources.R
import ch.brickinventoryapp.session.AppUiState
import ch.brickinventoryapp.state.ui.ScopeUiState
import ch.brickinventoryapp.state.ui.StorageUiState
import ch.brickinventoryapp.ui.components.LocalAddressRules
import ch.brickinventoryapp.ui.theme.BrickInventoryManagerTheme
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

/**
 * Every adding path of the collection asks for the storage location and starts at the default
 * (the star from settings); the set paths also ask for the owner, and without a household
 * no owner goes along.
 *
 * Counter-check (run here): `mutableStateOf(default)` → `mutableStateOf("")` for the location in
 * AddSetDialog → red “adding a set starts at the default location and asks for the owner”.
 * Counter-check (run here): `StorageLocationEntry(…)` removed from AdoptionDialog → red
 * “taking over from the watchlist starts at the default location”.
 * Counter-check (run here): `OwnerPicker(…)` removed from BarcodeResultDialog → red
 * “the barcode dialog starts at the default location and asks for the owner”.
 * Counter-check (run here): `glance.householdMembers.size > 1` → `> 0` in BarcodeResultDialog →
 * red “without a household the barcode dialog sends no owner”.
 */
@RunWith(RobolectricTestRunner::class)
class EntryPathsTest {

    @get:Rule
    val compose = createComposeRule()

    private val ctx: Context = ApplicationProvider.getApplicationContext()
    private val household = listOf(MemberView(id = 1, username = "ich", isSelf = true), MemberView(id = 7, username = "lea"))
    private val ownerRow get() = ctx.getString(R.string.household_for_account) + ": ich"

    private fun show(content: @Composable () -> Unit) {
        compose.setContent { CompositionLocalProvider(LocalAddressRules provides NetworkAddressRules) {  BrickInventoryManagerTheme { content() }  } }
        compose.waitForIdle()
    }

    private fun assertShown(text: String, what: String) =
        assertTrue("$what: “$text” not shown", compose.onAllNodesWithText(text, useUnmergedTree = true).fetchSemanticsNodes().isNotEmpty())

    private class Recorder : EntryActions {
        var wish: EntryRequest? = null
        override fun confirmAddBarcode(wish: EntryRequest) { this.wish = wish }
        override fun cancelBarcode() = Unit
        override fun cancelCheck() = Unit
    }

    private fun barcode(members: List<MemberView>): Recorder {
        val actions = Recorder()
        val state = BarcodeDialogState(AppUiState(), ScopeUiState(householdMembers = members),
            BarcodeUiState(result = "75192-1", setName = "Millennium Falcon"),
            StorageUiState(own = listOf(LocationEntryView(3, 1, "Regal A")), default = LocationEntryView(3, 1, "Regal A")))
        show { BarcodeResultDialog(state, actions, coil3.ImageLoader.Builder(ctx).build()) }
        return actions
    }

    @Test
    fun `adding a set starts at the default location and asks for the owner`() {
        show {
            AddSetDialog(onDismiss = {}, onAdd = {}, householdMembers = household, storageLocations = listOf("Regal A"),
                default = "Regal A", immediatelyFocus = false)
        }
        assertShown("Regal A", "location")
        assertShown(ownerRow, "owner")
    }

    @Test
    fun `taking over from the watchlist starts at the default location`() {
        show {
            AdoptionDialog(WantedItemView(setNumber = "10305-1", name = "Lion Knights' Castle"), storageLocations = listOf("Regal A"),
                locationDefault = "Regal A", onDismiss = {}, onAdopt = { _, _, _, _ -> })
        }
        assertShown("Regal A", "location")
    }

    @Test
    fun `the barcode dialog starts at the default location and asks for the owner`() {
        val actions = barcode(household)
        assertShown("Regal A", "location")
        assertShown(ownerRow, "owner")
        compose.onNodeWithText(ctx.getString(R.string.barcode_add)).performClick()
        compose.waitForIdle()
        assertEquals("owner", 1, actions.wish?.owner)
        assertEquals("location", "Regal A", actions.wish?.storageLocation)
    }

    @Test
    fun `without a household the barcode dialog sends no owner`() {
        val actions = barcode(listOf(MemberView(id = 1, username = "ich", isSelf = true)))
        compose.onNodeWithText(ctx.getString(R.string.barcode_add)).performClick()
        compose.waitForIdle()
        assertEquals("owner", null, actions.wish?.owner)
    }
}
