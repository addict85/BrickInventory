package ch.brickinventoryapp.login

import android.view.WindowManager
import android.view.inputmethod.EditorInfo
import androidx.activity.ComponentActivity
import androidx.compose.runtime.mutableStateOf
import androidx.compose.ui.test.junit4.v2.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import ch.brickinventoryapp.resources.R
import ch.brickinventoryapp.login.ui.AnmeldeFormular
import ch.brickinventoryapp.ui.components.Sichtschutz
import ch.brickinventoryapp.login.ui.screens.LoginScreen
import ch.brickinventoryapp.login.ui.screens.QrSetupScannerScreen
import ch.brickinventoryapp.ui.theme.BrickInventoryManagerTheme
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import androidx.compose.ui.ExperimentalComposeUiApi
import androidx.compose.ui.platform.InterceptPlatformTextInput

/**
 * Sign-in protects against overlaid windows (tapjacking on sign-in and
 * passkey) and, while the password is visible, against screenshots and the
 * app overview's preview image (FLAG_SECURE). The request "hide preview"
 * stays in effect once the password is hidden again.
 *
 * Counter-checks (Robolectric, measurable only in the CI; job `gegenproben`):
 *   (a) Ueberdeckungsschutz() removed from LoginScreen → red “sign-in is
 *       protected against overlay …” (gegenproben/anmeldung-ohne-ueberdeckungsschutz.patch)
 *   (b) Sichtschutz() removed for the visible password → red “a visible
 *       password …” (gegenproben/passwort-ohne-sichtschutz.patch)
 *   (c) KeyboardWithoutLearn no longer sets the flag → red “the keyboard
 *       does not learn password and code” (gegenproben/tastatur-lernt-mit.patch)
 *   (d) Sichtschutz() removed from QrSetupScannerScreen → red “the scanner for the
 *       sign-in code …” (gegenproben/qr-scanner-ohne-sichtschutz.patch)
 */
@RunWith(RobolectricTestRunner::class)
class LoginProtectionTest {

    @get:Rule
    val compose = createAndroidComposeRule<ComponentActivity>()

    private val ctx get() = compose.activity
    private fun geschuetzt() = (ctx.window.attributes.flags and WindowManager.LayoutParams.FLAG_SECURE) != 0

    private fun zeige(hidePreview: Boolean = false) {
        val global = mutableStateOf(hidePreview)
        compose.setContent {
            BrickInventoryManagerTheme {
                if (global.value) Sichtschutz()
                LoginScreen(
                    serverUrl = "https://brick.example.org", isLoading = false, error = null, codeNoetig = false,
                    formular = AnmeldeFormular.ANMELDEN, registrierungOffen = false, kontoLaeuft = false,
                    kontoMeldung = null, kontoFehler = null, onLogin = { _, _, _ -> },
                    onFormular = {}, onRegistrieren = { _, _, _, _, _ -> }, onPasswortVergessen = {}, onChangeServer = {},
                    onPasskey = {},
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
        var gesehen: EditorInfo? = null
        compose.setContent {
            InterceptPlatformTextInput(interceptor = { anfrage, _ ->
                gesehen = EditorInfo().also { anfrage.createInputConnection(it) }
                kotlinx.coroutines.awaitCancellation()
            }) {
                BrickInventoryManagerTheme {
                    LoginScreen(
                        serverUrl = "https://brick.example.org", isLoading = false, error = null, codeNoetig = true,
                        formular = AnmeldeFormular.ANMELDEN, registrierungOffen = false, kontoLaeuft = false,
                        kontoMeldung = null, kontoFehler = null, onLogin = { _, _, _ -> },
                        onFormular = {}, onRegistrieren = { _, _, _, _, _ -> }, onPasswortVergessen = {}, onChangeServer = {},
                    )
                }
            }
        }
        compose.onNodeWithText(ctx.getString(R.string.login_password)).performClick()
        compose.waitForIdle()
        val info = checkNotNull(gesehen) { "Das Passwortfeld hat keine Eingabe gestartet" }
        assertTrue("Die Tastatur darf das Passwort lernen",
            (info.imeOptions and EditorInfo.IME_FLAG_NO_PERSONALIZED_LEARNING) != 0)
    }

    @Test
    fun `the scanner for the sign-in code gets into no screenshot`() {
        compose.setContent { BrickInventoryManagerTheme { QrSetupScannerScreen(onResult = {}, onDismiss = {}) } }
        compose.waitForIdle()
        assertTrue("Das Kamerabild mit dem Anmeldecode ist nicht geschützt", geschuetzt())
    }

    @Test
    fun `the sign-in is protected against overlays, the passkey button too`() {
        zeige()
        assertTrue("Berührungen durch ein fremdes Fenster kämen an", ctx.window.decorView.filterTouchesWhenObscured)
    }

    @Test
    fun `a visible password gets into no screenshot`() {
        zeige()
        assertFalse("Ohne sichtbares Passwort braucht es keinen Sichtschutz", geschuetzt())
        compose.onNodeWithContentDescription(ctx.getString(R.string.cd_password_show)).performClick()
        compose.waitForIdle()
        assertTrue("Das sichtbare Passwort ist nicht geschützt", geschuetzt())
        compose.onNodeWithContentDescription(ctx.getString(R.string.cd_password_hide)).performClick()
        compose.waitForIdle()
        assertFalse("Nach dem Verdecken bleibt der Schutz stehen", geschuetzt())
    }

    @Test
    fun `hiding the preview stays when the password is hidden again`() {
        zeige(hidePreview = true)
        assertTrue(geschuetzt())
        compose.onNodeWithContentDescription(ctx.getString(R.string.cd_password_show)).performClick()
        compose.waitForIdle()
        compose.onNodeWithContentDescription(ctx.getString(R.string.cd_password_hide)).performClick()
        compose.waitForIdle()
        assertTrue("Der Wunsch des Nutzers ging mit dem Passwort verloren", geschuetzt())
    }
}
