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
 * Schutz auf dem Gerät: Ein Tipp, während ein fremdes Fenster einen Teil des
 * Bildschirms verdeckt, zählt in geschützten Bereichen nicht; ohne Wahl des
 * Nutzers zeigt die App-Übersicht kein Vorschaubild.
 *
 * Gegenproben (Robolectric, nur in der CI messbar; Job `gegenproben`):
 *   (a) Ueberdeckungsschutz() legt den Filter nicht an → rot „ein teilweise
 *       verdecktes Fenster …“ (gegenproben/teilweise-verdeckt-durchgelassen.patch)
 *   (b) hidePreview() mit Vorgabe false → rot „eine neue Installation
 *       verbirgt die Vorschau …“ (gegenproben/vorschau-vorgabe-aus.patch)
 *   (c) Schrittsperre zeigt den Inhalt ohne Bestätigung (`if (entsperrt || grund.isNotEmpty())`) →
 *       rot „the management shows itself only after the device lock“
 *       (gegenproben/verwaltung-ohne-geraetesperre.patch)
 *   (d) saveServerUrl() ruft die Hörer nicht → rot „ein anderer Server bricht
 *       laufende Aufrufe ab …“ (gegenproben/serverwechsel-ohne-abbruch.patch)
 *   (e) saveServerUrl() vergleicht beim Token nur die Herkunft → rot „ein anderer
 *       Pfad auf demselben Host verwirft den Token“ (gegenproben/pfadwechsel-behaelt-token.patch)
 *   (f) Sichtschutz() ohne Ueberdeckungsschutz() → rot „heikle Seiten sind
 *       vor Ueberlagerung geschuetzt“ (gegenproben/sichtschutz-ohne-ueberdeckung.patch)
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

    /** Ein Tipp, wie das System ihn liefert: über die Rückrufe des Fensters. */
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
     * Wächter für jede heikle Seite: Wer Sichtschutz oder die Schrittsperre
     * setzt, bekommt den Schutz vor Überlagerung mit — auch vor der Bestätigung. Nur
     * der app-weite Wunsch „Vorschau verbergen“ bleibt ohne.
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

    /** Token- und Geräteablage auf einem eigenen DataStore, wie Hilt sie verbindet. */
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
     * Die Verdrahtung für M1 (pruef6): Die Server-Clients hören hier mit (di/ServerClient.followsTheServer).
     * Ein anderer Pfad auf demselben Host ein anderer Server.
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

    /** Der Token hält nur die Herkunft; den Pfad trägt die bisherige Adresse bei. */
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
