package ch.brickinventoryapp.ui.components

import android.view.WindowManager
import androidx.activity.ComponentActivity
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.test.junit4.v2.createAndroidComposeRule
import ch.brickinventoryapp.ui.util.LocalSdkLevel
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner

/**
 * With the app lock switched on, the app overview shows no preview image, even if
 * "hide preview" is off: from Android 13 via setRecentsScreenshotEnabled(false),
 * below that via FLAG_SECURE. Without the lock both stay free.
 *
 * Counter-checks (patches under gegenproben/, Robolectric, measured by CI):
 *   uebersicht-ohne-sperrschutz    AppOverviewProtection() does nothing → red in both tests
 *   uebersicht-flag-ab-33          only FLAG_SECURE even from Android 13 → red „ab Android 13 …“
 */
@RunWith(RobolectricTestRunner::class)
class AppOverviewProtectionTest {

    /** Records the calls instead of handing them to the system service, which Robolectric doesn't replicate. */
    class OverviewProbe : ComponentActivity() {
        val vorschau = mutableListOf<Boolean>()
        override fun setRecentsScreenshotEnabled(enabled: Boolean) { vorschau += enabled }
    }

    private class Speicher(var minuten: Int) : AppLock.Ablage {
        override fun minuten() = minuten
        override fun setMinutes(minuten: Int) { this.minuten = minuten }
        override fun backgroundSince(): Long? = null
        override fun rememberBackground(seit: Long?) = Unit
        override fun backgroundStart(): Int? = null
        override fun rememberBackgroundStart(start: Int?) = Unit
        override fun gesperrt() = false
        override fun setLocked(an: Boolean) = Unit
    }

    @get:Rule
    val compose = createAndroidComposeRule<ComponentActivity>()

    private val probe = Robolectric.buildActivity(OverviewProbe::class.java).setup().get()
    private val lock = AppLock({ 0L }, Speicher(minuten = 0))
    private val stufe = mutableIntStateOf(33)

    private fun sicher() = (probe.window.attributes.flags and WindowManager.LayoutParams.FLAG_SECURE) != 0

    private fun zeige() {
        compose.setContent {
            CompositionLocalProvider(LocalContext provides probe, LocalSdkLevel provides stufe.intValue) {
                AppOverviewProtection(lock)
            }
        }
        compose.waitForIdle()
    }

    @Test
    fun `from Android 13 the lock hides only the thumbnail, off releases it`() {
        zeige()
        assertEquals("Ohne Sperre kein Eingriff", emptyList<Boolean>(), probe.vorschau)

        lock.setMinutes(5)
        compose.waitForIdle()
        assertEquals("Mit Sperre kein Vorschaubild", listOf(false), probe.vorschau)
        assertFalse("Bildschirmfotos bleiben erlaubt", sicher())

        lock.setMinutes(0)
        compose.waitForIdle()
        assertEquals("Sperre aus: Vorschaubild wieder frei", listOf(false, true), probe.vorschau)
    }

    @Test
    fun `below Android 13 the lock protects the window with FLAG_SECURE`() {
        stufe.intValue = 32
        zeige()
        assertFalse("Ohne Sperre kein Schutz", sicher())

        lock.setMinutes(1)
        compose.waitForIdle()
        assertTrue("Mit Sperre zeigt die Übersicht nichts", sicher())

        lock.setMinutes(0)
        compose.waitForIdle()
        assertFalse("Sperre aus: wieder frei", sicher())
    }
}
