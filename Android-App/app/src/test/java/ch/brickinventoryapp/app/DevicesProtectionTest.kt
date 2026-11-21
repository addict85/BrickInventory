package ch.brickinventoryapp.app

import ch.brickinventoryapp.testing.testVertrauenschiffre
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
import androidx.test.core.app.ApplicationProvider
import ch.brickinventoryapp.data.DevicesStore
import ch.brickinventoryapp.data.TokenAblage
import androidx.datastore.preferences.core.PreferenceDataStoreFactory
import ch.brickinventoryapp.ui.components.LocalSchrittschutz
import ch.brickinventoryapp.ui.components.Sichtschutz
import ch.brickinventoryapp.ui.components.Schrittschutz
import ch.brickinventoryapp.ui.components.Schrittsperre
import ch.brickinventoryapp.ui.components.Ueberdeckungsschutz
import ch.brickinventoryapp.ui.theme.BrickInventoryManagerTheme
import ch.brickinventoryapp.security.TokenEncryption
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertSame
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import java.io.File

/**
 * Protection on the device: a tap while a foreign window covers part of the
 * screen does not count in protected areas; without a choice by the
 * user the app overview shows no thumbnail.
 *
 * Counter-checks (Robolectric, measurable only in CI; job `gegenproben`):
 *   (a) Ueberdeckungsschutz() does not install the filter → red “a partially
 *       obscured window …” (gegenproben/teilweise-verdeckt-durchgelassen.patch)
 *   (b) hidePreview() with default false → red “a new installation
 *       hides the preview …” (gegenproben/vorschau-vorgabe-aus.patch)
 *   (c) Schrittsperre shows the content without confirmation (`if (entsperrt || grund.isNotEmpty())`) →
 *       red “the management shows itself only after the device lock”
 *       (gegenproben/verwaltung-ohne-geraetesperre.patch)
 *   (d) saveServerUrl() does not call the listeners → red “a different server cancels
 *       running calls …” (gegenproben/serverwechsel-ohne-abbruch.patch)
 *   (e) saveServerUrl() compares only the origin for the token → red “a different
 *       path on the same host discards the token” (gegenproben/pfadwechsel-behaelt-token.patch)
 *   (f) Sichtschutz() without Ueberdeckungsschutz() → red “sensitive pages are
 *       protected against overlays” (gegenproben/sichtschutz-ohne-ueberdeckung.patch)
 */
@RunWith(RobolectricTestRunner::class)
class DevicesProtectionTest {

    @get:Rule
    val compose = createAndroidComposeRule<ComponentActivity>()

    private var klicks = 0

    private fun zeige(geschuetzt: State<Boolean>) {
        compose.setContent {
            BrickInventoryManagerTheme {
                if (geschuetzt.value) Ueberdeckungsschutz()
                Button(onClick = { klicks++ }) { Text("Tippen") }
            }
        }
        compose.waitForIdle()
    }

    private fun event(aktion: Int, x: Float, y: Float, flags: Int, beginn: Long): MotionEvent {
        val p = MotionEvent.PointerProperties().apply { id = 0; toolType = MotionEvent.TOOL_TYPE_FINGER }
        val c = MotionEvent.PointerCoords().apply { this.x = x; this.y = y; pressure = 1f; size = 1f }
        return MotionEvent.obtain(beginn, SystemClock.uptimeMillis(), aktion, 1, arrayOf(p), arrayOf(c),
            0, 0, 1f, 1f, 0, 0, InputDevice.SOURCE_TOUCHSCREEN, flags)
    }

    /** A tap as the system delivers it: via the window's callbacks. */
    private fun tap(flags: Int) {
        val middle = compose.onNodeWithText("Tippen").fetchSemanticsNode().boundsInWindow.center
        compose.runOnUiThread {
            val beginn = SystemClock.uptimeMillis()
            for (aktion in listOf(MotionEvent.ACTION_DOWN, MotionEvent.ACTION_UP)) {
                val e = event(aktion, middle.x, middle.y, flags, beginn)
                compose.activity.window.callback.dispatchTouchEvent(e)
                e.recycle()
            }
        }
        compose.waitForIdle()
    }

    @Test
    fun `a partially obscured window triggers no click in the protected area`() {
        zeige(mutableStateOf(true))
        tap(MotionEvent.FLAG_WINDOW_IS_PARTIALLY_OBSCURED)
        assertEquals("Der Tipp unter einem fremden Fenster kam an", 0, klicks)
        tap(0)
        assertEquals("Ein gewöhnlicher Tipp kam nicht an", 1, klicks)
    }

    @Test
    fun `after the protected area the tap applies again`() {
        val geschuetzt = mutableStateOf(true)
        zeige(geschuetzt)
        geschuetzt.value = false
        compose.waitForIdle()
        assertSame("Der Filter blieb am Fenster", compose.activity, compose.activity.window.callback)
        tap(MotionEvent.FLAG_WINDOW_IS_PARTIALLY_OBSCURED)
        assertEquals(1, klicks)
    }

    /**
     * Guard for every sensitive page: whoever sets Sichtschutz or the Schrittsperre
     * gets the overlay protection along — also before the confirmation. Only
     * the app-wide wish „Vorschau verbergen“ stays without.
     */
    @Test
    fun `sensitive pages are protected against overlays`() {
        val seite = mutableStateOf("keine")
        compose.setContent {
            BrickInventoryManagerTheme {
                CompositionLocalProvider(LocalSchrittschutz provides Schrittschutz { _, _ -> }) {
                    when (seite.value) {
                        "sichtschutz" -> Sichtschutz()
                        "schrittsperre" -> Schrittsperre("Verwaltung") { Text("Verwalteraktion") }
                        "vorschau" -> Sichtschutz(coverage = false)
                    }
                    Text("Seite")
                }
            }
        }
        val fenster = compose.activity.window.decorView
        for ((name, erwartet) in listOf("sichtschutz" to true, "keine" to false, "schrittsperre" to true, "vorschau" to false)) {
            compose.runOnUiThread { seite.value = name }
            compose.waitForIdle()
            assertEquals("$name: Schutz vor Überlagerung", erwartet, fenster.filterTouchesWhenObscured)
        }
    }

    @Test
    fun `the management shows itself only after the device lock`() {
        var bestaetigen: (() -> Unit)? = null
        compose.setContent {
            BrickInventoryManagerTheme {
                CompositionLocalProvider(LocalSchrittschutz provides Schrittschutz { _, weiter -> bestaetigen = weiter }) {
                    Schrittsperre("Verwaltung") { Text("Verwalteraktion") }
                }
            }
        }
        compose.waitForIdle()
        compose.onNodeWithText("Verwalteraktion").assertDoesNotExist()
        val weiter = bestaetigen
        assertTrue("Beim Öffnen wird nicht gefragt", weiter != null)
        compose.runOnUiThread { weiter?.invoke() }
        compose.waitForIdle()
        compose.onNodeWithText("Verwalteraktion").assertExists()
    }

    /** Token and device store on their own DataStore, as Hilt wires them. */
    private fun stores(): Pair<TokenAblage, DevicesStore> {
        val ctx = ApplicationProvider.getApplicationContext<Context>()
        val store = PreferenceDataStoreFactory.create { File(ctx.filesDir, "test-${System.nanoTime()}.preferences_pb") }
        val geraet = DevicesStore(ctx, store, testVertrauenschiffre())
        val tresor = object : TokenEncryption {
            override fun verschluessle(klartext: String) = klartext
            override fun entschluessle(gespeichert: String) = gespeichert
        }
        return TokenAblage(store, tresor, geraet, CoroutineScope(SupervisorJob() + Dispatchers.IO)) to geraet
    }

    /**
     * The wiring for M1 (pruef6): the server clients listen in here (di/ServerClient.followsTheServer).
     * A different path on the same host is a different server.
     */
    @Test
    fun `a different server cancels running calls, the same one does not`() {
        val (prefs, geraet) = stores()
        var abgebrochen = 0
        var userCa = 0
        prefs.onServerwechsel { abgebrochen++ }
        geraet.onUserCaSwitch { userCa++ }
        kotlinx.coroutines.runBlocking {
            prefs.saveServerUrl("https://alt.example/brick")
            abgebrochen = 0
            prefs.saveServerUrl("https://ALT.example:443/brick/")
            assertEquals("Derselbe Server bricht nichts ab", 0, abgebrochen)
            prefs.saveServerUrl("https://alt.example/andere")
            assertEquals("Ein anderer Pfad ist eine andere Anwendung", 1, abgebrochen)
            prefs.saveServerUrl("https://neu.example")
            assertEquals(2, abgebrochen)
        }
        geraet.setUserCa(true)
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
            assertEquals("Derselbe Server behält den Token", "token-brick", prefs.tokenJetzt())
            prefs.saveServerUrl("https://geteilt.example/andere-app")
            assertEquals("", prefs.tokenJetzt())
        }
    }

    @Test
    fun `a new installation hides the preview until the user turns it off`() {
        val (_, prefs) = stores()
        assertTrue("Ohne Wahl zeigt die App-Übersicht alles", prefs.hidePreview())
        prefs.setzeVorschauVerbergen(false)
        assertFalse(prefs.hidePreview())
    }
}
