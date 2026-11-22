package ch.brickinventoryapp.login

import android.content.Context
import androidx.compose.material3.Text
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.onAllNodesWithText
import androidx.test.core.app.ApplicationProvider
import ch.brickinventoryapp.login.ui.LoginOrServerStart
import ch.brickinventoryapp.model.domain.StartStateView
import ch.brickinventoryapp.resources.R
import ch.brickinventoryapp.ui.theme.BrickInventoryManagerTheme
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

/**
 * While the server starts, the sign-in shows its progress instead of the form; once it has
 * started the form comes back, and a sign-in during the start still leads into the app.
 *
 * Counter-checks (run here): the form drawn next to the progress (`ServerStartDisplay(…); form()`) →
 * red “while the server starts …”; the LaunchedEffect inside the form branch → red “a sign-in during the start …”.
 */
@RunWith(RobolectricTestRunner::class)
class ServerStartLoginTest {

    @get:Rule
    val compose = createComposeRule()

    private val ctx: Context = ApplicationProvider.getApplicationContext()
    private var start by mutableStateOf<StartStateView?>(StartStateView(ready = false, step = "Datenbank", undercut = null, progress = 2.0, total = 5))
    private var loggedIn by mutableStateOf(false)
    private var jumps = 0

    private fun show() {
        compose.setContent {
            BrickInventoryManagerTheme { LoginOrServerStart(start, loggedIn, { jumps++ }) { Text("the form") } }
        }
        compose.waitForIdle()
    }

    private fun shown(text: String) = compose.onAllNodesWithText(text).fetchSemanticsNodes().isNotEmpty()

    @Test
    fun `while the server starts the progress stands instead of the form`() {
        show()
        assertTrue(shown(ctx.getString(R.string.startup_title)))
        assertTrue("the form stands next to the progress", !shown("the form"))
        start = null
        compose.waitForIdle()
        assertTrue(shown("the form"))
        assertTrue(!shown(ctx.getString(R.string.startup_title)))
    }

    @Test
    fun `a sign-in during the start still leads into the app`() {
        show()
        loggedIn = true
        compose.waitForIdle()
        assertEquals(1, jumps)
    }
}
