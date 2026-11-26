package ch.brickinventoryapp.account

import android.view.WindowManager
import androidx.activity.ComponentActivity
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.mutableStateOf
import androidx.compose.ui.test.junit4.v2.createAndroidComposeRule
import ch.brickinventoryapp.account.ui.SecondFactorUiState
import ch.brickinventoryapp.account.ui.screens.SecondFactorCard
import ch.brickinventoryapp.model.ui.theme.Design
import ch.brickinventoryapp.ui.components.LocalStepGuard
import ch.brickinventoryapp.ui.components.StepGuard
import ch.brickinventoryapp.ui.theme.BrickInventoryManagerTheme
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

/**
 * The settings' second-factor card: while the key or the fresh recovery codes stand in plain
 * text, the window carries FLAG_SECURE (no screenshot, no preview); afterwards it is free again.
 *
 * Counter-checks:
 *   PrivacyShield() removed from FreshCodes → red “the fresh codes guard the window”
 *   PrivacyShield() removed from KeyForTheApp → red “the key guards the window”
 *   PrivacyShield() added to the not-set-up branch → red “without key and codes the window stays free”
 */
@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(qualifiers = "de-rCH-w411dp-h891dp-port-xxhdpi")
class SecondFactorCardPrivacyTest {

    @get:Rule
    val compose = createAndroidComposeRule<ComponentActivity>()

    private val condition = mutableStateOf(SecondFactorUiState(active = false))

    private fun show() {
        compose.setContent {
            BrickInventoryManagerTheme(theme = Design.CLASSIC) {
                CompositionLocalProvider(LocalStepGuard provides StepGuard { _, then -> then() }) {
                    SecondFactorCard(condition.value, onSetUp = {}, onConfirm = {}, onNewCodes = {},
                        onTurnOff = {}, onBack = {})
                }
            }
        }
        compose.waitForIdle()
    }

    private fun guarded() =
        (compose.activity.window.attributes.flags and WindowManager.LayoutParams.FLAG_SECURE) != 0

    @Test
    fun `the fresh codes guard the window`() {
        condition.value = SecondFactorUiState(active = true, codes = listOf("aaaa-bbbb", "cccc-dddd"))
        show()
        assertTrue("codes in plain text without FLAG_SECURE", guarded())
        condition.value = SecondFactorUiState(active = true)
        compose.waitForIdle()
        assertFalse("FLAG_SECURE stays after the codes are gone", guarded())
    }

    @Test
    fun `the key guards the window`() {
        condition.value = SecondFactorUiState(active = false, secret = "JBSWY3DPEHPK3PXP",
            otpauth = "otpauth://totp/Brick:marco?secret=JBSWY3DPEHPK3PXP")
        show()
        assertTrue("key in plain text without FLAG_SECURE", guarded())
    }

    @Test
    fun `without key and codes the window stays free`() {
        show()
        assertFalse("FLAG_SECURE without anything secret on screen", guarded())
    }
}
