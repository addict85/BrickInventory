package ch.brickinventoryapp.login

import androidx.activity.ComponentActivity
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.test.junit4.v2.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performScrollTo
import ch.brickinventoryapp.login.ui.screens.SetupScreen
import ch.brickinventoryapp.resources.R
import ch.brickinventoryapp.ui.components.AppLock
import ch.brickinventoryapp.ui.components.LocalAppLock
import ch.brickinventoryapp.ui.theme.BrickInventoryManagerTheme
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

/**
 * Setup offers the app lock, with an explanation and the same choice as the
 * settings.
 *
 * Counter-check (Robolectric, measurable only in the CI):
 *   the card removed from SetupScreen → red “setup offers the app lock …”;
 *   gegenproben/einrichtung-ohne-app-sperre.patch
 */
@RunWith(RobolectricTestRunner::class)
class SetupAppLockTest {

    @get:Rule
    val compose = createAndroidComposeRule<ComponentActivity>()

    private class Speicher : AppLock.Ablage {
        var minuten = AppLock.DEFAULT_MINUTES
        override fun minuten() = minuten
        override fun setMinutes(minuten: Int) { this.minuten = minuten }
        override fun backgroundSince(): Long? = null
        override fun rememberBackground(seit: Long?) = Unit
        override fun backgroundStart(): Int? = null
        override fun rememberBackgroundStart(start: Int?) = Unit
        override fun gesperrt() = false
        override fun setLocked(an: Boolean) = Unit
    }

    @Test
    fun `the setup offers the app lock, with an explanation`() {
        val lock = AppLock({ 0L }, Speicher())
        compose.setContent {
            BrickInventoryManagerTheme {
                CompositionLocalProvider(LocalAppLock provides lock) {
                    SetupScreen(currentUrl = "", onSave = {})
                }
            }
        }
        val ctx = compose.activity
        compose.onNodeWithText(ctx.getString(R.string.app_sperre_einrichten)).performScrollTo()
        compose.onNodeWithText(ctx.getString(R.string.app_sperre_titel)).assertExists()
        // The chosen level is that of the store: the same choice as in the settings.
        compose.onNodeWithText(ctx.getString(R.string.app_sperre_minuten, AppLock.DEFAULT_MINUTES)).assertExists()
        assertEquals(AppLock.DEFAULT_MINUTES, lock.minuten.value)
    }
}
