package ch.brickinventoryapp.account

import android.content.Context
import androidx.compose.foundation.rememberScrollState
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.test.core.app.ApplicationProvider
import ch.brickinventoryapp.account.ui.screens.SettingsExits
import ch.brickinventoryapp.account.ui.screens.SettingsScreen
import ch.brickinventoryapp.account.ui.screens.SettingsState
import ch.brickinventoryapp.account.ui.viewmodel.SettingsActions
import ch.brickinventoryapp.model.appearance.Design
import ch.brickinventoryapp.resources.R
import ch.brickinventoryapp.session.AppUiState
import ch.brickinventoryapp.state.ui.viewmodel.AppearanceActions
import ch.brickinventoryapp.ui.theme.BrickInventoryManagerTheme
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import java.lang.reflect.Proxy

/**
 * Settings split what stays on this phone from what follows the account: language and
 * appearance under „Dieses Gerät“, currency and price choices under „Konto“.
 *
 * Counter-check (counter-checks/settings-one-card.patch): price settings back in the
 * device card, no account card → red “device and account settings …”
 */
@RunWith(RobolectricTestRunner::class)
@Config(qualifiers = "de-rCH-w411dp-h2400dp-port-xxhdpi")
class SettingsGroupsTest {

    @get:Rule
    val compose = createComposeRule()

    private val ctx: Context = ApplicationProvider.getApplicationContext()

    private inline fun <reified T> none(): T =
        Proxy.newProxyInstance(T::class.java.classLoader, arrayOf(T::class.java)) { _, _, _ -> null } as T

    /** Top edge of the first node showing [id]; card titles may be set in capitals. */
    private fun top(id: Int): Float {
        val text = ctx.getString(id)
        val nodes = compose.onAllNodes(hasText(text, ignoreCase = true), useUnmergedTree = true).fetchSemanticsNodes()
        assertTrue("“$text” not shown", nodes.isNotEmpty())
        return nodes.first().boundsInRoot.top
    }

    @Test
    fun `device and account settings stand in two cards`() {
        compose.setContent {
            BrickInventoryManagerTheme(theme = Design.CLASSIC) {
                SettingsScreen(
                    condition = SettingsState(AppUiState(serverUrl = "https://brick.example.org"),
                        "system", Design.CLASSIC, false, false, false, false),
                    actions = none<SettingsActions>(), appearance = none<AppearanceActions>(),
                    exits = none<SettingsExits>(), scrollState = rememberScrollState(),
                )
            }
        }
        compose.waitForIdle()
        val device = top(R.string.settings_group_device)
        val account = top(R.string.settings_group_account)
        assertTrue("language in the device card", device < top(R.string.settings_language))
        assertTrue("appearance before the account card", top(R.string.settings_dark_label) < account)
        assertTrue("currency in the account card", account < top(R.string.settings_currency))
        assertTrue("price choice in the account card", account < top(R.string.settings_price_condition))
        assertTrue("preselection in the account card", account < top(R.string.settings_default_condition))
    }
}
