package ch.brickinventoryapp.parts

import androidx.activity.ComponentActivity
import androidx.compose.ui.test.assertIsEnabled
import androidx.compose.ui.test.hasClickAction
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.junit4.v2.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import ch.brickinventoryapp.parts.ui.PlSet
import ch.brickinventoryapp.parts.ui.TeilelisteUiState
import ch.brickinventoryapp.parts.ui.screens.PartsListScreen
import ch.brickinventoryapp.resources.R
import ch.brickinventoryapp.ui.theme.BrickInventoryManagerTheme
import coil3.ImageLoader
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/**
 * The collected sets of the build list: each chip names its removal (TalkBack hears
 * „21318-1 aus der Bauliste entfernen“, not only the number); „Bauliste erstellen“ with
 * nothing to create stays tappable and marks the empty field instead of creating.
 *
 * Counter-checks (not locally runnable, to be checked in CI — Robolectric):
 *   the chip back to AssistChip with `Icon(Icons.Default.Close, null)` → red “a chip names …”
 *     (no node with the remove label)
 *   `enabled = anzahl > 0 && !isLoading` on the main button again → red “create with nothing …”
 *     (assertIsEnabled fails)
 *   erstellen() without the check for anzahl == 0 → red “create with nothing …” (onErstelle called)
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35], qualifiers = "de-rCH-w411dp-h891dp-port-xxhdpi")
class BuildListChipsTest {

    @get:Rule
    val compose = createAndroidComposeRule<ComponentActivity>()

    private fun text(id: Int, vararg a: Any) = compose.activity.getString(id, *a)
    private val entfernt = mutableListOf<Int>()
    private val erstellt = mutableListOf<String>()

    private fun zeige(sets: List<PlSet>) {
        compose.setContent {
            BrickInventoryManagerTheme {
                PartsListScreen(TeilelisteUiState(sets = sets), serverUrl = "",
                    imageLoader = ImageLoader.Builder(compose.activity).build(), onScanBarcode = {},
                    onEntferne = { entfernt += it }, onErstelle = { erstellt += it })
            }
        }
        compose.waitForIdle()
    }

    @Test
    fun `a chip names what tapping it removes`() {
        zeige(listOf(PlSet("10294-1", "Titanic"), PlSet("21318-1", "21318-1")))
        compose.onNodeWithText("10294-1 — Titanic").fetchSemanticsNode("Name fehlt am Chip")
        compose.onNodeWithContentDescription(text(R.string.partslist_remove_set, "21318-1")).performClick()
        compose.waitForIdle()
        assertEquals(listOf(1), entfernt)
    }

    @Test
    fun `create with nothing to create marks the field instead`() {
        zeige(emptyList())
        val knopf = compose.onNode(hasText(text(R.string.partslist_generate)) and hasClickAction())
        knopf.assertIsEnabled().performClick()
        compose.waitForIdle()
        assertEquals(emptyList<String>(), erstellt)
        compose.onNodeWithText(text(R.string.partslist_set_missing)).fetchSemanticsNode("Kein Hinweis am Feld")
    }
}
