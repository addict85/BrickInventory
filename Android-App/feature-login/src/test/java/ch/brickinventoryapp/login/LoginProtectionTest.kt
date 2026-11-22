package ch.brickinventoryapp.login

import android.view.WindowManager
import android.view.inputmethod.EditorInfo
import androidx.activity.ComponentActivity
import androidx.compose.runtime.mutableStateOf
import androidx.compose.ui.ExperimentalComposeUiApi
import androidx.compose.ui.platform.InterceptPlatformTextInput
import androidx.compose.ui.test.junit4.v2.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import ch.brickinventoryapp.login.ui.screens.LoginActions
import ch.brickinventoryapp.login.ui.screens.LoginScreen
import ch.brickinventoryapp.login.ui.screens.LoginScreenState
import ch.brickinventoryapp.login.ui.screens.QrSetupScannerScreen
import ch.brickinventoryapp.resources.R
import ch.brickinventoryapp.ui.components.PrivacyShield
import ch.brickinventoryapp.ui.theme.BrickInventoryManagerTheme
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

/**
 * Sign-in protects against overlaid windows (tapjacking on sign-in and
 * passkey) and, while the password is visible, against screenshots and the
 * app overview's preview image (FLAG_SECURE). The request "hide preview"
 * stays in effect once the password is hidden again.
 *
 * Counter-checks (Robolectric, measurable only in the CI; job `counter-checks`):
 *   (a) OverlayGuard() removed from LoginScreen → red “sign-in is
 *       protected against overlay …” (counter-checks/anmeldung-ohne-ueberdeckungsschutz.patch)
 *   (b) PrivacyShield() removed for the visible password → red “a visible
 *       password …” (counter-checks/passwort-ohne-sichtschutz.patch)
 *   (c) KeyboardWithoutLearn no longer sets the flag → red “the keyboard
 *       does not learn password and code” (counter-checks/tastatur-lernt-mit.patch)
 *   (d) PrivacyShield() removed from QrSetupScannerScreen → red “the scanner for the
 *       sign-in code …” (counter-checks/qr-scanner-ohne-sichtschutz.patch)
 */
@RunWith(RobolectricTestRunner::class)
class LoginProtectionTest {

    @get:Rule
    val compose = createAndroidComposeRule<ComponentActivity>()

    private val ctx get() = compose.activity
    private fun guarded() = (ctx.window.attributes.flags and WindowManager.LayoutParams.FLAG_SECURE) != 0

    private fun show(hidePreview: Boolean = false) {
        val global = mutableStateOf(hidePreview)
        compose.setContent {
            BrickInventoryManagerTheme {
                if (global.value) PrivacyShield()
                LoginScreen(
                    LoginScreenState(serverUrl = "https://brick.example.org", registrationOpen = false),
                    object : LoginActions {
                        override val offersPasskey get() = true
                    },
                )
            }
        }
        compose.waitForIdle()
    }

    // A second interceptor on the outside: it sees the request the way sign-in passes
    // it to the keyboard, and asks about the EditorInfo that would result from it.
    @OptIn(ExperimentalComposeUiApi::class)
    @Test
    fun `the keyboard does not learn password and code`() {
        var seen: EditorInfo? = null
        compose.setContent {
            InterceptPlatformTextInput(interceptor = { request, _ ->
                seen = EditorInfo().also { request.createInputConnection(it) }
                kotlinx.coroutines.awaitCancellation()
            }) {
                BrickInventoryManagerTheme {
                    LoginScreen(
                        LoginScreenState(serverUrl = "https://brick.example.org", codeNeeded = true, registrationOpen = false),
                        object : LoginActions {},
                    )
                }
            }
        }
        compose.onNodeWithText(ctx.getString(R.string.login_password)).performClick()
        compose.waitForIdle()
        val info = checkNotNull(seen) { "The password field started no input" }
        assertTrue("the keyboard may learn the password",
            (info.imeOptions and EditorInfo.IME_FLAG_NO_PERSONALIZED_LEARNING) != 0)
    }

    @Test
    fun `the scanner for the sign-in code gets into no screenshot`() {
        compose.setContent { BrickInventoryManagerTheme { QrSetupScannerScreen(onResult = {}, onDismiss = {}) } }
        compose.waitForIdle()
        assertTrue("the camera image with the sign-in code is not protected", guarded())
    }

    @Test
    fun `the sign-in is protected against overlays, the passkey button too`() {
        show()
        assertTrue("touches through a foreign window would get through", ctx.window.decorView.filterTouchesWhenObscured)
    }

    @Test
    fun `a visible password gets into no screenshot`() {
        show()
        assertFalse("without a visible password no privacy screen is needed", guarded())
        compose.onNodeWithContentDescription(ctx.getString(R.string.cd_password_show)).performClick()
        compose.waitForIdle()
        assertTrue("the visible password is not protected", guarded())
        compose.onNodeWithContentDescription(ctx.getString(R.string.cd_password_hide)).performClick()
        compose.waitForIdle()
        assertFalse("after covering, the protection stays on", guarded())
    }

    @Test
    fun `hiding the preview stays when the password is hidden again`() {
        show(hidePreview = true)
        assertTrue(guarded())
        compose.onNodeWithContentDescription(ctx.getString(R.string.cd_password_show)).performClick()
        compose.waitForIdle()
        compose.onNodeWithContentDescription(ctx.getString(R.string.cd_password_hide)).performClick()
        compose.waitForIdle()
        assertTrue("the user's wish got lost with the password", guarded())
    }
}
