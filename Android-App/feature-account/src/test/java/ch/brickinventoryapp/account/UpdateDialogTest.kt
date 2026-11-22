package ch.brickinventoryapp.account

import androidx.activity.ComponentActivity
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.test.assertCountEquals
import androidx.compose.ui.test.junit4.v2.createAndroidComposeRule
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import ch.brickinventoryapp.account.ui.UpdateUiState
import ch.brickinventoryapp.account.ui.dialogs.UpdateDialog
import ch.brickinventoryapp.account.ui.viewmodel.UpdateActions
import ch.brickinventoryapp.model.util.AppVersion
import ch.brickinventoryapp.resources.R
import ch.brickinventoryapp.ui.components.LocalAppVersion
import ch.brickinventoryapp.ui.theme.BrickInventoryManagerTheme
import ch.brickinventoryapp.update.util.UpdateDescription
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/**
 * The update notice on start, rendered: it only asks — loading starts only on
 * "Update now", never on just showing it — and after "Later" it doesn't ask again in this
 * app run. That "Later" lands in the state and expires on sign-out is
 * checked by UpdateViewModelTest.
 *
 * Counter-checks (patches under counter-checks/, Robolectric, measured by CI):
 *   update-dialog-laedt-selbst   LaunchedEffect loads on show → red "der Hinweis fragt …"
 *   update-spaeter-vergessen     dialogRejected ignored → red "nach Später …"
 *   version-leer                 versionsName() without a fallback → red "ohne bekannte Version …"
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35])
class UpdateDialogTest {

    @get:Rule
    val compose = createAndroidComposeRule<ComponentActivity>()

    private fun text(id: Int) = compose.activity.getString(id)

    private val newValue = UpdateDescription(versionCode = 20, versionName = "2.20",
        apkUrl = "https://github.com/x/y/releases/download/android-v2.20/BrickInventory.apk")

    /** Counts what the dialog triggers; "Later" sets the state like the ViewModel does. */
    private class Actions(val later: () -> Unit = {}) : UpdateActions {
        var loaded = 0
        var closed = 0
        override fun checkOnUpdate(still: Boolean) = Unit
        override fun checkOnStart() = Unit
        override fun setStartCheck(an: Boolean) = Unit
        override fun closeUpdateHint() { closed++; later() }
        override fun loadUpdate() { loaded++ }
        override fun cancelLoad() = Unit
        override fun startInstallation() = Unit
    }

    @Test
    fun `the hint asks, loading starts only on the click`() {
        val actions = Actions()
        compose.setContent { BrickInventoryManagerTheme { UpdateDialog(UpdateUiState(newerVersion = newValue), actions) } }
        compose.waitForIdle()
        compose.onNodeWithText(text(R.string.update_dialog_title)).fetchSemanticsNode()
        assertEquals("showing alone already loads", 0, actions.loaded)

        compose.onNodeWithText(text(R.string.update_dialog_now)).performClick()
        compose.waitForIdle()
        assertEquals(1, actions.loaded)
    }

    @Test
    fun `after Later the hint does not ask again in this run`() {
        var condition by mutableStateOf(UpdateUiState(newerVersion = newValue))
        val actions = Actions { condition = condition.copy(dialogRejected = true) }
        compose.setContent { BrickInventoryManagerTheme { UpdateDialog(condition, actions) } }
        compose.waitForIdle()

        compose.onNodeWithText(text(R.string.update_dialog_later)).performClick()
        compose.waitForIdle()

        assertEquals(1, actions.closed)
        assertEquals(0, actions.loaded)
        compose.onAllNodesWithText(text(R.string.update_dialog_title)).assertCountEquals(0)
    }

    @Test
    fun `without a known version unknown is shown, otherwise the version`() {
        var version by mutableStateOf(AppVersion("", 0))
        compose.setContent {
            BrickInventoryManagerTheme {
                CompositionLocalProvider(LocalAppVersion provides version) {
                    UpdateDialog(UpdateUiState(newerVersion = newValue), Actions())
                }
            }
        }
        compose.waitForIdle()
        val unknown = text(R.string.update_version_unknown)
        compose.onNodeWithText(compose.activity.getString(R.string.update_dialog_text, "2.20", unknown))
            .fetchSemanticsNode("Die installierte Version bleibt leer")
        version = AppVersion("2.10", 10)
        compose.waitForIdle()
        compose.onNodeWithText(compose.activity.getString(R.string.update_dialog_text, "2.20", "2.10")).fetchSemanticsNode()
    }
}
