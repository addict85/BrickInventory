package ch.brickinventoryapp.catalog

import android.content.Context
import androidx.compose.runtime.Composable
import androidx.compose.ui.test.hasClickAction
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.performClick
import androidx.test.core.app.ApplicationProvider
import ch.brickinventoryapp.catalog.ui.screens.CatalogAddDialog
import ch.brickinventoryapp.catalog.ui.screens.WantedItemDialog
import ch.brickinventoryapp.model.domain.Condition
import ch.brickinventoryapp.model.domain.EntryRequest
import ch.brickinventoryapp.model.domain.MemberView
import ch.brickinventoryapp.resources.R
import ch.brickinventoryapp.ui.theme.BrickInventoryManagerTheme
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

/**
 * From the catalog detail a set goes into the gallery with owner and the default storage
 * location, and onto the watchlist with the chosen account.
 *
 * Counter-check (run here): `StorageLocationEntry(…)` removed from CatalogAddDialog → red
 * “adding from the catalog starts at the default location and asks for the owner”.
 * Counter-check (run here): `OwnerPicker(householdMembers, account, …)` removed from
 * WantedItemDialog → red “the watchlist dialog asks for the account”.
 */
@RunWith(RobolectricTestRunner::class)
class CatalogEntryDialogsTest {

    @get:Rule
    val compose = createComposeRule()

    private val ctx: Context = ApplicationProvider.getApplicationContext()
    private val household = listOf(MemberView(id = 1, username = "ich", isSelf = true), MemberView(id = 7, username = "lea"))
    private val ownerRow get() = ctx.getString(R.string.household_for_account) + ": ich"

    private fun show(content: @Composable () -> Unit) {
        compose.setContent { BrickInventoryManagerTheme { content() } }
        compose.waitForIdle()
    }

    private fun shown(text: String) = compose.onAllNodesWithText(text, useUnmergedTree = true).fetchSemanticsNodes().isNotEmpty()

    private fun confirm(button: Int) {
        compose.onNode(hasText(ctx.getString(button)) and hasClickAction()).performClick()
        compose.waitForIdle()
    }

    @Test
    fun `adding from the catalog starts at the default location and asks for the owner`() {
        var wish: EntryRequest? = null
        show {
            CatalogAddDialog("Millennium Falcon", Condition.NEW, household, listOf("Regal A"), locationDefault = "Regal A",
                onDismiss = {}, onAdd = { wish = it })
        }
        assertTrue("owner row not shown", shown(ownerRow))
        assertTrue("location: “Regal A” not shown", shown("Regal A"))
        confirm(R.string.catalog_add_confirm)
        assertEquals("owner", 1, wish?.owner)
        assertEquals("location", "Regal A", wish?.storageLocation)
    }

    @Test
    fun `the watchlist dialog asks for the account`() {
        var account: Int? = null
        show {
            WantedItemDialog("Millennium Falcon", Condition.NEW, household, onDismiss = {},
                onWish = { _, _, _, chosen -> account = chosen })
        }
        assertTrue("account row not shown", shown(ownerRow))
        confirm(R.string.wanted_add_submit)
        assertEquals("account", 1, account)
    }
}
