package ch.brickinventoryapp.account

import androidx.activity.ComponentActivity
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.semantics.getOrNull
import androidx.compose.ui.state.ToggleableState
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.isToggleable
import androidx.compose.ui.test.junit4.v2.createAndroidComposeRule
import androidx.compose.ui.test.performClick
import ch.brickinventoryapp.account.ui.screens.PriceAlertCard
import ch.brickinventoryapp.resources.R
import ch.brickinventoryapp.ui.theme.BrickInventoryManagerTheme
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/**
 * The device switch for price-alert notifications is a named switch, and tapping it passes the
 * wish on even though Android asks for the permission at the same time.
 *
 * Counter-check (run here): `toggleOn(newValue)` removed from the switch → red
 * “a tap passes the wish on” (null instead of true).
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
}
