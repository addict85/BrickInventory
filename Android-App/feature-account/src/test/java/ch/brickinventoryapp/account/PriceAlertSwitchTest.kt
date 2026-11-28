package ch.brickinventoryapp.account

import android.app.NotificationChannel
import android.app.NotificationManager
import android.provider.Settings
import androidx.activity.ComponentActivity
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.semantics.getOrNull
import androidx.compose.ui.state.ToggleableState
import androidx.compose.ui.test.hasClickAction
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.isToggleable
import androidx.compose.ui.test.junit4.v2.createAndroidComposeRule
import androidx.compose.ui.test.performClick
import ch.brickinventoryapp.account.ui.screens.PriceAlertCard
import ch.brickinventoryapp.model.util.PRICE_ALERT_CHANNEL
import ch.brickinventoryapp.resources.R
import ch.brickinventoryapp.ui.theme.BrickInventoryManagerTheme
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config

/**
 * The device switch for price-alert notifications is a named switch, and tapping it passes the
 * wish on even though Android asks for the permission at the same time.
 *
 * Counter-check (run here): `toggleOn(newValue)` removed from the switch → red
 * “a tap passes the wish on” (null instead of true).
 *
 * With the switch on and notifications off (app-wide or the price-alert channel), a hint
 * leads to the system settings; with notifications allowed it stays away.
 * Counter-check (counter-checks/alarm-blocked-without-hint.patch): the hint no longer
 * shown → red “blocked notifications show a hint …”.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35])
class PriceAlertSwitchTest {

    @get:Rule
    val compose = createAndroidComposeRule<ComponentActivity>()

    @Test
    fun `the price alert switch is a named switch and a tap passes the wish on`() {
        var wish: Boolean? = null
        compose.setContent { BrickInventoryManagerTheme { PriceAlertCard(false) { wish = it } } }
        val text = compose.activity.getString(R.string.alert_notify)
        val node = compose.onNode(hasText(text) and isToggleable()).fetchSemanticsNode("$text is not a named switch")
        assertEquals("$text: role", Role.Switch, node.config.getOrNull(SemanticsProperties.Role))
        assertEquals("$text: state", ToggleableState.Off, node.config.getOrNull(SemanticsProperties.ToggleableState))
        compose.onNode(hasText(text) and isToggleable()).performClick()
        compose.waitForIdle()
        assertEquals("a tap passes the wish on", true, wish)
    }

    private val manager get() = compose.activity.getSystemService(NotificationManager::class.java)

    private fun hintShown(): Boolean {
        compose.setContent { BrickInventoryManagerTheme { PriceAlertCard(true) {} } }
        compose.waitForIdle()
        return compose.onAllNodes(hasText(compose.activity.getString(R.string.alert_notify_blocked)))
            .fetchSemanticsNodes().isNotEmpty()
    }

    @Test
    fun `blocked notifications show a hint that opens the system settings`() {
        shadowOf(manager).setNotificationsEnabled(false)
        assertTrue("no hint although notifications are off", hintShown())
        compose.onNode(hasText(compose.activity.getString(R.string.alert_open_system_settings)) and hasClickAction())
            .performClick()
        val started = shadowOf(compose.activity.application).nextStartedActivity
        assertEquals("settings page", Settings.ACTION_APP_NOTIFICATION_SETTINGS, started?.action)
        assertEquals("for this app", compose.activity.packageName, started?.getStringExtra(Settings.EXTRA_APP_PACKAGE))
    }

    @Test
    fun `a muted price alert channel shows the hint too`() {
        manager.createNotificationChannel(NotificationChannel(PRICE_ALERT_CHANNEL, "Preisalarm", NotificationManager.IMPORTANCE_NONE))
        assertTrue("no hint although the channel is muted", hintShown())
    }

    @Test
    fun `allowed notifications show no hint`() {
        shadowOf(manager).setNotificationsEnabled(true)
        assertEquals("hint although notifications are allowed", false, hintShown())
    }
}
