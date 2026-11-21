package ch.brickinventoryapp.app

import androidx.activity.ComponentActivity
import androidx.compose.ui.test.junit4.v2.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.fragment.app.FragmentActivity
import ch.brickinventoryapp.resources.R
import ch.brickinventoryapp.ui.components.DevicesStepProtection
import ch.brickinventoryapp.ui.components.WithoutLockWarning
import ch.brickinventoryapp.ui.theme.BrickInventoryManagerTheme
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner

/**
 * A device without a screen lock: voucher PIN, recovery codes
 * and management no longer open silently there, the app first says that they are
 * unprotected. Robolectric by itself reports no secured device.
 *
 * Counter-check: in DevicesStepProtection.bestaetige() without lock again `weiter()`
 * instead of `withoutLock.frage(…)` → red “without a screen lock the step guard warns
 * …” (the step went on silently); gegenproben/ohne-sperre-still.patch
 */
@RunWith(RobolectricTestRunner::class)
class WithoutLockTest {

    @get:Rule
    val compose = createAndroidComposeRule<ComponentActivity>()

    @Test
    fun `without a screen lock the step guard warns instead of silently letting through`() {
        val aktivitaet = Robolectric.buildActivity(FragmentActivity::class.java).setup().get()
        val protection = DevicesStepProtection(aktivitaet) { "" }
        var weiter = 0
        compose.runOnUiThread { protection.confirm("Gutschein-PIN anzeigen") { weiter++ } }
        assertEquals("Ohne Sperre ging der Schritt still weiter", 0, weiter)

        compose.setContent { BrickInventoryManagerTheme { WithoutLockWarning(protection.withoutLock) } }
        compose.onNodeWithText("Gutschein-PIN anzeigen", substring = true).assertExists()
        compose.onNodeWithText(compose.activity.getString(R.string.common_cancel)).performClick()
        compose.waitForIdle()
        assertEquals("Abbrechen lässt nichts durch", 0, weiter)
        assertNull(protection.withoutLock.wartet)

        compose.runOnUiThread { protection.confirm("Gutschein-PIN anzeigen") { weiter++ } }
        compose.onNodeWithText(compose.activity.getString(R.string.schritt_ohne_sperre_weiter)).performClick()
        compose.waitForIdle()
        assertEquals("Ungeschützt fortfahren führt den Schritt aus", 1, weiter)

        compose.runOnUiThread { protection.confirm("Verwaltung öffnen") { weiter++ } }
        assertEquals("Das Ja gilt bis zur Frist wie eine Bestätigung", 2, weiter)
    }
}
