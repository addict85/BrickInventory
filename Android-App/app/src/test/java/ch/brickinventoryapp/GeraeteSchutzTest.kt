package ch.brickinventoryapp

import android.content.Context
import android.os.SystemClock
import android.view.InputDevice
import android.view.MotionEvent
import androidx.activity.ComponentActivity
import androidx.compose.material3.Button
import androidx.compose.material3.Text
import androidx.compose.runtime.State
import androidx.compose.runtime.mutableStateOf
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.test.core.app.ApplicationProvider
import ch.brickinventoryapp.data.PreferencesManager
import ch.brickinventoryapp.ui.components.Ueberdeckungsschutz
import ch.brickinventoryapp.ui.theme.BrickInventoryManagerTheme
import ch.brickinventoryapp.util.TokenVerschluesselung
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertSame
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/**
 * Schutz auf dem Gerät: Ein Tipp, während ein fremdes Fenster einen Teil des
 * Bildschirms verdeckt, zählt in geschützten Bereichen nicht; ohne Wahl des
 * Nutzers zeigt die App-Übersicht kein Vorschaubild.
 *
 * Gegenproben (Robolectric, nur in der CI messbar; Job `gegenproben`):
 *   (a) Ueberdeckungsschutz() legt den Filter nicht an → rot „ein teilweise
 *       verdecktes Fenster …“ (gegenproben/teilweise-verdeckt-durchgelassen.patch)
 *   (b) vorschauVerbergen() mit Vorgabe false → rot „eine neue Installation
 *       verbirgt die Vorschau …“ (gegenproben/vorschau-vorgabe-aus.patch)
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35])
class GeraeteSchutzTest {

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

    private fun ereignis(aktion: Int, x: Float, y: Float, flags: Int, beginn: Long): MotionEvent {
        val p = MotionEvent.PointerProperties().apply { id = 0; toolType = MotionEvent.TOOL_TYPE_FINGER }
        val c = MotionEvent.PointerCoords().apply { this.x = x; this.y = y; pressure = 1f; size = 1f }
        return MotionEvent.obtain(beginn, SystemClock.uptimeMillis(), aktion, 1, arrayOf(p), arrayOf(c),
            0, 0, 1f, 1f, 0, 0, InputDevice.SOURCE_TOUCHSCREEN, flags)
    }

    /** Ein Tipp, wie das System ihn liefert: über die Rückrufe des Fensters. */
    private fun tippe(flags: Int) {
        val mitte = compose.onNodeWithText("Tippen").fetchSemanticsNode().boundsInWindow.center
        compose.runOnUiThread {
            val beginn = SystemClock.uptimeMillis()
            for (aktion in listOf(MotionEvent.ACTION_DOWN, MotionEvent.ACTION_UP)) {
                val e = ereignis(aktion, mitte.x, mitte.y, flags, beginn)
                compose.activity.window.callback.dispatchTouchEvent(e)
                e.recycle()
            }
        }
        compose.waitForIdle()
    }

    @Test
    fun `ein teilweise verdecktes Fenster loest im geschuetzten Bereich keinen Klick aus`() {
        zeige(mutableStateOf(true))
        tippe(MotionEvent.FLAG_WINDOW_IS_PARTIALLY_OBSCURED)
        assertEquals("Der Tipp unter einem fremden Fenster kam an", 0, klicks)
        tippe(0)
        assertEquals("Ein gewöhnlicher Tipp kam nicht an", 1, klicks)
    }

    @Test
    fun `nach dem geschuetzten Bereich gilt der Tipp wieder`() {
        val geschuetzt = mutableStateOf(true)
        zeige(geschuetzt)
        geschuetzt.value = false
        compose.waitForIdle()
        assertSame("Der Filter blieb am Fenster", compose.activity, compose.activity.window.callback)
        tippe(MotionEvent.FLAG_WINDOW_IS_PARTIALLY_OBSCURED)
        assertEquals(1, klicks)
    }

    @Test
    fun `eine neue Installation verbirgt die Vorschau, bis der Nutzer es ausschaltet`() {
        val ctx = ApplicationProvider.getApplicationContext<Context>()
        val prefs = PreferencesManager(ctx, object : TokenVerschluesselung {
            override fun verschluessle(klartext: String) = klartext
            override fun entschluessle(gespeichert: String) = gespeichert
        })
        assertTrue("Ohne Wahl zeigt die App-Übersicht alles", prefs.vorschauVerbergen())
        prefs.setzeVorschauVerbergen(false)
        assertFalse(prefs.vorschauVerbergen())
    }
}
