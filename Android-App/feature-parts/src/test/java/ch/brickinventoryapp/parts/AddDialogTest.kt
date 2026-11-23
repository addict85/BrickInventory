package ch.brickinventoryapp.parts

import androidx.activity.ComponentActivity
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.test.assertIsNotEnabled
import androidx.compose.ui.test.hasAnyAncestor
import androidx.compose.ui.test.hasClickAction
import androidx.compose.ui.test.hasSetTextAction
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.isDialog
import androidx.compose.ui.test.junit4.v2.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performTextClearance
import androidx.compose.ui.test.performTextInput
import ch.brickinventoryapp.model.domain.FigureEntry
import ch.brickinventoryapp.model.domain.PartEntry
import ch.brickinventoryapp.parts.ui.screens.AddMinifigDialog
import ch.brickinventoryapp.parts.ui.screens.AddPartDialog
import ch.brickinventoryapp.resources.R
import ch.brickinventoryapp.ui.components.addClosable
import ch.brickinventoryapp.ui.theme.BrickInventoryManagerTheme
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.shadows.ShadowDialog

/**
 * Entering a part and a minifigure: an incomplete input does not close the dialog, the
 * field says what is missing; only a valid entry goes out. A filled-in dialog
 * closes neither by tapping beside it nor by back without a confirmation prompt (AddDialog).
 *
 * Counter-checks (patches under counter-checks/, Robolectric, measured by CI):
 *   part-capture-closes-silently  "Hinzufügen" calls submit() and onDismiss() again → red “without a part number …”
 *   figure-capture-closes-silently the same in the figures dialog → red “without a figure number …”
 *   capture-discards-without-asking   back also closes filled-in input right away → red “back asks …”
 *   capture-outside-closes     addClosable always allows tapping beside it → red “tapping beside it …”
 */
@RunWith(RobolectricTestRunner::class)
class AddDialogTest {

    @get:Rule
    val compose = createAndroidComposeRule<ComponentActivity>()

    private fun text(id: Int) = compose.activity.getString(id)
    private val parts = mutableListOf<PartEntry>()
    private val figures = mutableListOf<FigureEntry>()
    private var closed = 0

    private fun showPart() {
        compose.setContent {
            BrickInventoryManagerTheme {
                var open by remember { mutableStateOf(true) }
                if (open) AddPartDialog(onDismiss = { open = false; closed++ }, onAdd = { parts += it; open = false })
            }
        }
        compose.waitForIdle()
    }

    private fun showMinifig() {
        compose.setContent {
            BrickInventoryManagerTheme {
                var open by remember { mutableStateOf(true) }
                if (open) AddMinifigDialog(onDismiss = { open = false; closed++ }, onAdd = { figures += it; open = false })
            }
        }
        compose.waitForIdle()
    }

    private fun button(id: Int) = compose.onNode(hasText(text(id)) and hasClickAction() and hasAnyAncestor(isDialog()))
    private fun field(id: Int) = compose.onNode(hasSetTextAction() and hasText(text(id)))

    private fun tap(id: Int) {
        button(id).performClick()
        compose.waitForIdle()
    }

    /** Back, as the system gives it to the topmost dialog window. */
    @Suppress("DEPRECATION")
    private fun back() {
        compose.runOnUiThread { ShadowDialog.getLatestDialog().onBackPressed() }
        compose.waitForIdle()
    }

    @Test
    fun `without a part number the dialog stays open and the field says why`() {
        showPart()
        tap(R.string.parts_add_button)
        assertEquals("The dialog closed without an entry", 0, closed)
        assertEquals(emptyList<PartEntry>(), parts)
        compose.onNodeWithText(text(R.string.parts_number_missing)).assertExists()

        field(R.string.parts_part_number).performTextInput("3001")
        tap(R.string.parts_add_button)
        assertEquals(listOf("3001"), parts.map { it.number })
        assertEquals("Success closes via onAdd, not via cancel", 0, closed)
    }

    @Test
    fun `without a figure number the dialog stays open and the field says why`() {
        showMinifig()
        tap(R.string.minifigs_add_button)
        assertEquals("The dialog closed without an entry", 0, closed)
        compose.onNodeWithText(text(R.string.minifigs_number_missing)).assertExists()

        field(R.string.minifigs_fig_number).performTextInput("fig-007357")
        tap(R.string.minifigs_add_button)
        assertEquals(listOf("fig-007357"), figures.map { it.number })
    }

    @Test
    fun `an unreadable quantity disables Add`() {
        showPart()
        field(R.string.common_quantity).performTextClearance()
        field(R.string.common_quantity).performTextInput("0")
        compose.waitForIdle()
        button(R.string.parts_add_button).assertIsNotEnabled()
        compose.onNodeWithText(text(R.string.record_quantity_invalid)).assertExists()
    }

    @Test
    fun `back asks first when there are inputs`() {
        showPart()
        field(R.string.parts_part_number).performTextInput("3001")
        compose.waitForIdle()
        back()
        assertEquals("Back discarded the typed text without asking", 0, closed)
        compose.onNodeWithText(text(R.string.record_discard_title)).assertExists()
        tap(R.string.record_discard)
        assertEquals(1, closed)
    }

    @Test
    fun `back closes an empty dialog immediately`() {
        showPart()
        back()
        assertEquals("An empty dialog closes without asking", 1, closed)
    }

    @Test
    fun `tapping outside closes only an empty dialog`() {
        assertTrue(addClosable(changed = false).dismissOnClickOutside)
        assertFalse(addClosable(changed = true).dismissOnClickOutside)
        assertTrue("Back stays open and then asks", addClosable(changed = true).dismissOnBackPress)
    }
}
