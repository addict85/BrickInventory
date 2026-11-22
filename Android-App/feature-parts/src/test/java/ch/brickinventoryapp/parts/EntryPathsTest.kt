package ch.brickinventoryapp.parts

import android.content.Context
import androidx.compose.runtime.Composable
import androidx.compose.ui.test.hasSetTextAction
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performTextInput
import androidx.test.core.app.ApplicationProvider
import ch.brickinventoryapp.model.domain.FigureEntry
import ch.brickinventoryapp.model.domain.MemberView
import ch.brickinventoryapp.model.domain.PartEntry
import ch.brickinventoryapp.parts.ui.screens.AddMinifigDialog
import ch.brickinventoryapp.parts.ui.screens.AddPartDialog
import ch.brickinventoryapp.resources.R
import ch.brickinventoryapp.ui.theme.BrickInventoryManagerTheme
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

/**
 * Adding a manual part or minifigure asks for the owner and starts at the default storage
 * location; what is entered goes along with the entry, and without a household no owner does.
 *
 * Counter-check (run here): `OwnerPicker(…)` removed from AddPartDialog → red “a part asks for
 * the owner and starts at the default location”.
 * Counter-check (run here): `mutableStateOf(locationDefault)` → `mutableStateOf("")` in
 * AddMinifigDialog → red “a minifigure asks for the owner and starts at the default location”.
 * Counter-check (run here): in entryValues `household.size > 1` → `> 0` → red “without a household
 * a part goes without an owner”.
 */
@RunWith(RobolectricTestRunner::class)
class EntryPathsTest {

    @get:Rule
    val compose = createComposeRule()

    private val ctx: Context = ApplicationProvider.getApplicationContext()
    private val self = MemberView(id = 1, username = "ich", isSelf = true)
    private val household = listOf(self, MemberView(id = 7, username = "lea"))
    private val ownerRow get() = ctx.getString(R.string.household_for_account) + ": ich"

    private fun show(content: @Composable () -> Unit) {
        compose.setContent { BrickInventoryManagerTheme { content() } }
        compose.waitForIdle()
    }

    private fun shown(text: String) = compose.onAllNodesWithText(text, useUnmergedTree = true).fetchSemanticsNodes().isNotEmpty()

    private fun type(label: Int, text: String) =
        compose.onNode(hasSetTextAction() and hasText(ctx.getString(label))).performTextInput(text)

    private fun confirm(button: Int) {
        compose.onNodeWithText(ctx.getString(button)).performClick()
        compose.waitForIdle()
    }

    private fun part(members: List<MemberView>): PartEntry? {
        var entry: PartEntry? = null
        show {
            AddPartDialog(onDismiss = {}, onAdd = { entry = it }, householdMembers = members,
                storageLocations = listOf("Regal A"), locationDefault = "Regal A")
        }
        assertTrue("location: “Regal A” not shown", shown("Regal A"))
        assertEquals("owner row", members.size > 1, shown(ownerRow))
        type(R.string.parts_part_number, "3001")
        confirm(R.string.parts_add_button)
        return entry
    }

    @Test
    fun `a part asks for the owner and starts at the default location`() {
        val entry = part(household)
        assertEquals("owner", 1, entry?.owner)
        assertEquals("location", "Regal A", entry?.storageLocation)
    }

    @Test
    fun `without a household a part goes without an owner`() {
        assertEquals("owner", null, part(listOf(self))?.owner)
    }

    @Test
    fun `a minifigure asks for the owner and starts at the default location`() {
        var entry: FigureEntry? = null
        show {
            AddMinifigDialog(onDismiss = {}, onAdd = { entry = it }, householdMembers = household,
                storageLocations = listOf("Regal A"), locationDefault = "Regal A")
        }
        assertTrue("owner row not shown", shown(ownerRow))
        type(R.string.minifigs_fig_number, "sw0001")
        confirm(R.string.minifigs_add_button)
        assertEquals("owner", 1, entry?.owner)
        assertEquals("location", "Regal A", entry?.storageLocation)
    }
}
