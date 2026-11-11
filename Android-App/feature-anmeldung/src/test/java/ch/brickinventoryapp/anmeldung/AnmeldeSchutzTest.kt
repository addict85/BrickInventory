package ch.brickinventoryapp.anmeldung

import android.view.WindowManager
import android.view.inputmethod.EditorInfo
import androidx.activity.ComponentActivity
import androidx.compose.runtime.mutableStateOf
import androidx.compose.ui.test.junit4.v2.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import ch.brickinventoryapp.ressourcen.R
import ch.brickinventoryapp.anmeldung.ui.AnmeldeFormular
import ch.brickinventoryapp.ui.components.Sichtschutz
import ch.brickinventoryapp.anmeldung.ui.screens.LoginScreen
import ch.brickinventoryapp.anmeldung.ui.screens.QrSetupScannerScreen
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
 * Die Anmeldung schützt vor überlagerten Fenstern (Tapjacking auf Anmelden und
 * Passkey) und, solange das Passwort sichtbar ist, vor Bildschirmfotos und dem
 * Vorschaubild der App-Übersicht (FLAG_SECURE). Der Wunsch „Vorschau verbergen“
 * bleibt bestehen, wenn das Passwort wieder verdeckt wird.
 *
 * Gegenproben (Robolectric, nur in der CI messbar; Job `gegenproben`):
 *   (a) Ueberdeckungsschutz() aus LoginScreen entfernt → rot „die Anmeldung ist
 *       vor Ueberlagerung geschuetzt …“ (gegenproben/anmeldung-ohne-ueberdeckungsschutz.patch)
 *   (b) Sichtschutz() für das sichtbare Passwort entfernt → rot „ein sichtbares
 *       Passwort …“ (gegenproben/passwort-ohne-sichtschutz.patch)
 *   (c) TastaturOhneLernen setzt die Flagge nicht mehr → rot „Passwort
 *       und Code lernt die Tastatur nicht mit“ (gegenproben/tastatur-lernt-mit.patch)
 *   (d) Sichtschutz() aus QrSetupScannerScreen entfernt → rot „der Scanner fuer den
 *       Anmeldecode …“ (gegenproben/qr-scanner-ohne-sichtschutz.patch)
 */
@RunWith(RobolectricTestRunner::class)
class AnmeldeSchutzTest {

    @get:Rule
    val compose = createAndroidComposeRule<ComponentActivity>()

    private val ctx get() = compose.activity
    private fun geschuetzt() = (ctx.window.attributes.flags and WindowManager.LayoutParams.FLAG_SECURE) != 0

    private fun zeige(vorschauVerbergen: Boolean = false) {
        val global = mutableStateOf(vorschauVerbergen)
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

    // Aussen ein zweiter Abfänger: Er sieht die Anfrage so, wie die Anmeldung sie an die
    // Tastatur weitergibt, und fragt nach dem EditorInfo, das daraus entstünde.
    @OptIn(ExperimentalComposeUiApi::class)
    @Test
    fun `Passwort und Code lernt die Tastatur nicht mit`() {
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
    fun `der Scanner fuer den Anmeldecode kommt in kein Bildschirmfoto`() {
        compose.setContent { BrickInventoryManagerTheme { QrSetupScannerScreen(onResult = {}, onDismiss = {}) } }
        compose.waitForIdle()
        assertTrue("Das Kamerabild mit dem Anmeldecode ist nicht geschützt", geschuetzt())
    }

    @Test
    fun `die Anmeldung ist vor Ueberlagerung geschuetzt, auch der Passkey-Knopf`() {
        zeige()
        assertTrue("Berührungen durch ein fremdes Fenster kämen an", ctx.window.decorView.filterTouchesWhenObscured)
    }

    @Test
    fun `ein sichtbares Passwort kommt in kein Bildschirmfoto`() {
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
    fun `Vorschau verbergen bleibt, wenn das Passwort wieder verdeckt wird`() {
        zeige(vorschauVerbergen = true)
        assertTrue(geschuetzt())
        compose.onNodeWithContentDescription(ctx.getString(R.string.cd_password_show)).performClick()
        compose.waitForIdle()
        compose.onNodeWithContentDescription(ctx.getString(R.string.cd_password_hide)).performClick()
        compose.waitForIdle()
        assertTrue("Der Wunsch des Nutzers ging mit dem Passwort verloren", geschuetzt())
    }
}
