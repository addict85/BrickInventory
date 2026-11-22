package ch.brickinventoryapp.app

import android.content.Context
import android.os.SystemClock
import android.view.InputDevice
import android.view.MotionEvent
import androidx.activity.ComponentActivity
import androidx.compose.material3.Button
import androidx.compose.material3.Text
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.State
import androidx.compose.runtime.mutableStateOf
import androidx.compose.ui.test.junit4.v2.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.datastore.preferences.core.PreferenceDataStoreFactory
import androidx.test.core.app.ApplicationProvider
import ch.brickinventoryapp.data.DevicesStore
import ch.brickinventoryapp.data.TokenStore
import ch.brickinventoryapp.data.testing.testTrustCipher
import ch.brickinventoryapp.security.TokenEncryption
import ch.brickinventoryapp.ui.components.LocalStepGuard
import ch.brickinventoryapp.ui.components.OverlayGuard
import ch.brickinventoryapp.ui.components.PrivacyShield
import ch.brickinventoryapp.ui.components.StepGuard
import ch.brickinventoryapp.ui.components.StepLock
import ch.brickinventoryapp.ui.theme.BrickInventoryManagerTheme
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertSame
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import java.io.File

/**
 * Protection on the device: a tap while a foreign window covers part of the
 * screen does not count in protected areas; without a choice by the
 * user the app overview shows no thumbnail.
 *
 * Counter-checks (Robolectric, measurable only in CI; job `counter-checks`):
 *   (a) OverlayGuard() does not install the filter → red “a partially
 *       obscured window …” (counter-checks/teilweise-verdeckt-durchgelassen.patch)
 *   (b) hidePreview() with default false → red “a new installation
 *       hides the preview …” (counter-checks/vorschau-vorgabe-aus.patch)
 *   (c) Schrittsperre shows the content without confirmation (`if (unlocked || reason.isNotEmpty())`) →
 *       red “the management shows itself only after the device lock”
 *       (counter-checks/verwaltung-ohne-geraetesperre.patch)
 *   (d) saveServerUrl() does not call the listeners → red “a different server cancels
 *       running calls …” (counter-checks/serverwechsel-ohne-abbruch.patch)
 *   (e) saveServerUrl() compares only the origin for the token → red “a different
 *       path on the same host discards the token” (counter-checks/pfadwechsel-behaelt-token.patch)
 *   (f) PrivacyShield() without OverlayGuard() → red “sensitive pages are
 *       protected against overlays” (counter-checks/sichtschutz-ohne-ueberdeckung.patch)
 */
@RunWith(RobolectricTestRunner::class)
class DevicesProtectionTest {

    @get:Rule
    val compose = createAndroidComposeRule<ComponentActivity>()

    private var clicks = 0

    private fun show(guarded: State<Boolean>) {
        compose.setContent {
            BrickInventoryManagerTheme {
                if (guarded.value) OverlayGuard()
                Button(onClick = { clicks++ }) { Text("Tippen") }
            }
        }
        compose.waitForIdle()
    }

    private fun event(action: Int, x: Float, y: Float, flags: Int, begin: Long): MotionEvent {
        val p = MotionEvent.PointerProperties().apply { id = 0; toolType = MotionEvent.TOOL_TYPE_FINGER }
        val c = MotionEvent.PointerCoords().apply { this.x = x; this.y = y; pressure = 1f; size = 1f }
        return MotionEvent.obtain(begin, SystemClock.uptimeMillis(), action, 1, arrayOf(p), arrayOf(c),
            0, 0, 1f, 1f, 0, 0, InputDevice.SOURCE_TOUCHSCREEN, flags)
    }

    /** A tap as the system delivers it: via the window's callbacks. */
    private fun tap(flags: Int) {
        val middle = compose.onNodeWithText("Tippen").fetchSemanticsNode().boundsInWindow.center
        compose.runOnUiThread {
            val begin = SystemClock.uptimeMillis()
            for (action in listOf(MotionEvent.ACTION_DOWN, MotionEvent.ACTION_UP)) {
                val e = event(action, middle.x, middle.y, flags, begin)
                compose.activity.window.callback.dispatchTouchEvent(e)
                e.recycle()
            }
        }
        compose.waitForIdle()
    }

    @Test
    fun `a partially obscured window triggers no click in the protected area`() {
        show(mutableStateOf(true))
        tap(MotionEvent.FLAG_WINDOW_IS_PARTIALLY_OBSCURED)
        assertEquals("Der Tipp unter einem fremden Fenster kam an", 0, clicks)
        tap(0)
        assertEquals("Ein gewöhnlicher Tipp kam nicht an", 1, clicks)
    }

    @Test
    fun `after the protected area the tap applies again`() {
        val guarded = mutableStateOf(true)
        show(guarded)
        guarded.value = false
        compose.waitForIdle()
        assertSame("Der Filter blieb am Fenster", compose.activity, compose.activity.window.callback)
        tap(MotionEvent.FLAG_WINDOW_IS_PARTIALLY_OBSCURED)
        assertEquals(1, clicks)
    }

    /**
     * Guard for every sensitive page: whoever sets Sichtschutz or the Schrittsperre
     * gets the overlay protection along — also before the confirmation. Only
     * the app-wide wish „Vorschau verbergen“ stays without.
     */
    @Test
    fun `sensitive pages are protected against overlays`() {
        val page = mutableStateOf("keine")
        compose.setContent {
            BrickInventoryManagerTheme {
                CompositionLocalProvider(LocalStepGuard provides StepGuard { _, _ -> }) {
                    when (page.value) {
                        "sichtschutz" -> PrivacyShield()
                        "schrittsperre" -> StepLock("Verwaltung") { Text("Verwalteraktion") }
                        "vorschau" -> PrivacyShield(coverage = false)
                    }
                    Text("Seite")
                }
            }
        }
        val window = compose.activity.window.decorView
        for ((name, expected) in listOf("sichtschutz" to true, "keine" to false, "schrittsperre" to true, "vorschau" to false)) {
            compose.runOnUiThread { page.value = name }
            compose.waitForIdle()
            assertEquals("$name: Schutz vor Überlagerung", expected, window.filterTouchesWhenObscured)
        }
    }

    @Test
    fun `the management shows itself only after the device lock`() {
        var confirm: (() -> Unit)? = null
        compose.setContent {
            BrickInventoryManagerTheme {
                CompositionLocalProvider(LocalStepGuard provides StepGuard { _, next -> confirm = next }) {
                    StepLock("Verwaltung") { Text("Verwalteraktion") }
                }
            }
        }
        compose.waitForIdle()
        compose.onNodeWithText("Verwalteraktion").assertDoesNotExist()
        val next = confirm
        assertTrue("Beim Öffnen wird nicht gefragt", next != null)
        compose.runOnUiThread { next?.invoke() }
        compose.waitForIdle()
        compose.onNodeWithText("Verwalteraktion").assertExists()
    }

    /** Token and device store on their own DataStore, as Hilt wires them. */
    private fun stores(): Pair<TokenStore, DevicesStore> {
        val ctx = ApplicationProvider.getApplicationContext<Context>()
        val store = PreferenceDataStoreFactory.create { File(ctx.filesDir, "test-${System.nanoTime()}.preferences_pb") }
        val device = DevicesStore(ctx, store, testTrustCipher())
        val vault = object : TokenEncryption {
            override fun encrypt(plaintext: String) = plaintext
            override fun decrypt(saved: String) = saved
        }
        return TokenStore(store, vault, device, CoroutineScope(SupervisorJob() + Dispatchers.IO)) to device
    }

    /**
     * The wiring for M1 (pruef6): the server clients listen in here (di/ServerClient.followsTheServer).
     * A different path on the same host is a different server.
     */
    @Test
    fun `a different server cancels running calls, the same one does not`() {
        val (prefs, device) = stores()
        var cancelled = 0
        var userCa = 0
        prefs.onServerSwitch { cancelled++ }
        device.onUserCaSwitch { userCa++ }
        kotlinx.coroutines.runBlocking {
            prefs.saveServerUrl("https://alt.example/brick")
            cancelled = 0
            prefs.saveServerUrl("https://ALT.example:443/brick/")
            assertEquals("Derselbe Server bricht nichts ab", 0, cancelled)
            prefs.saveServerUrl("https://alt.example/andere")
            assertEquals("Ein anderer Pfad ist eine andere Anwendung", 1, cancelled)
            prefs.saveServerUrl("https://neu.example")
            assertEquals(2, cancelled)
        }
        device.setUserCa(true)
        assertEquals("Der TLS-Kontext wird nach dem Umschalten neu gebaut", 1, userCa)
    }

    /** The token holds only the origin; the previous address contributes the path. */
    @Test
    fun `a different path on the same host discards the token`() {
        val (prefs, _) = stores()
        kotlinx.coroutines.runBlocking {
            prefs.saveServerUrl("https://geteilt.example/brick")
            prefs.saveAuthToken("token-brick")
            prefs.saveServerUrl("https://geteilt.example/brick/")
            assertEquals("Derselbe Server behält den Token", "token-brick", prefs.tokenNow())
            prefs.saveServerUrl("https://geteilt.example/andere-app")
            assertEquals("", prefs.tokenNow())
        }
    }

    @Test
    fun `a new installation hides the preview until the user turns it off`() {
        val (_, prefs) = stores()
        assertTrue("Ohne Wahl zeigt die App-Übersicht alles", prefs.hidePreview())
        prefs.applyPreviewHidden(false)
        assertFalse(prefs.hidePreview())
    }
}
