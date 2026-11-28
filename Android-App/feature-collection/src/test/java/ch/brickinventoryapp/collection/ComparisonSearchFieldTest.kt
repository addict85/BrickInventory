package ch.brickinventoryapp.collection

import ch.brickinventoryapp.ui.components.LocalAddressRules
import ch.brickinventoryapp.network.util.NetworkAddressRules
import androidx.compose.runtime.CompositionLocalProvider
import android.text.InputType
import android.view.View
import android.view.ViewGroup
import android.view.inputmethod.EditorInfo
import androidx.activity.ComponentActivity
import androidx.compose.ui.test.hasSetTextAction
import androidx.compose.ui.test.junit4.v2.createAndroidComposeRule
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performImeAction
import androidx.compose.ui.test.performTextInput
import ch.brickinventoryapp.collection.ui.screens.ComparisonScreen
import ch.brickinventoryapp.collection.ui.viewmodel.ComparisonActions
import ch.brickinventoryapp.collection.ui.viewmodel.ComparisonUiState
import ch.brickinventoryapp.ui.theme.BrickInventoryManagerTheme
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/**
 * The price comparison's search field takes set numbers: it filters what is typed, shows the
 * number keyboard and starts the search with the keyboard's search key.
 *
 * Counter-checks (local, Robolectric):
 *   `NumericInput.setNumber(it)` → `it`                  → red “typed text is filtered …”
 *   `integerKeyboard(ImeAction.Search)` → `ImeAction.Done` → red “the keyboard …” (IME action 6, not 3)
 *   `KeyboardType.Number` → `Text` in integerKeyboard     → red “the keyboard …” (input class 1, not 2)
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35])
class ComparisonSearchFieldTest {

    @get:Rule
    val compose = createAndroidComposeRule<ComponentActivity>()

    private val typed = mutableListOf<String>()
    private var searches = 0

    private val actions = object : ComparisonActions {
        override fun setSearch(text: String) { typed += text }
        override fun clearSearch() = Unit
        override fun openScanner() = Unit
        override fun closeScanner() = Unit
        override fun scanned(barcode: String) = Unit
        override fun search() { searches++ }
        override fun queryOpened() = Unit
    }

    private fun show() {
        compose.setContent { CompositionLocalProvider(LocalAddressRules provides NetworkAddressRules) {  BrickInventoryManagerTheme { ComparisonScreen(ComparisonUiState(), actions) }  }}
        compose.waitForIdle()
    }

    /** The view that holds the input connection of the focused field. */
    private fun editor(root: View): View? = when {
        root.onCheckIsTextEditor() -> root
        root is ViewGroup -> (0 until root.childCount).firstNotNullOfOrNull { editor(root.getChildAt(it)) }
        else -> null
    }

    @Test
    fun `typed text is filtered to a set number`() {
        show()
        compose.onNode(hasSetTextAction()).performTextInput("75192-1 !")
        compose.waitForIdle()
        assertEquals(listOf("75192-1"), typed)
    }

    @Test
    fun `the keyboard shows digits and a search key that searches`() {
        show()
        val field = compose.onNode(hasSetTextAction())
        field.performClick()
        compose.waitForIdle()
        val info = EditorInfo()
        val view = checkNotNull(editor(compose.activity.window.decorView)) { "no text editor after focusing the field" }
        compose.runOnIdle { view.onCreateInputConnection(info) }
        assertEquals(InputType.TYPE_CLASS_NUMBER, info.inputType and InputType.TYPE_MASK_CLASS)
        assertEquals(EditorInfo.IME_ACTION_SEARCH, info.imeOptions and EditorInfo.IME_MASK_ACTION)
        field.performImeAction()
        compose.waitForIdle()
        assertEquals(1, searches)
    }
}
