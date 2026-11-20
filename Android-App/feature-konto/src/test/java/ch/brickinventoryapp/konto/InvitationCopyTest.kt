package ch.brickinventoryapp.konto

import android.content.ClipboardManager
import androidx.activity.ComponentActivity
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.mutableStateOf
import androidx.compose.ui.Modifier
import androidx.compose.ui.test.hasClickAction
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.junit4.v2.createAndroidComposeRule
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import ch.brickinventoryapp.konto.ui.HouseholdUiState
import ch.brickinventoryapp.konto.ui.screens.HouseholdCard
import ch.brickinventoryapp.model.fach.HouseholdStatusView
import ch.brickinventoryapp.model.fach.Waehrung
import ch.brickinventoryapp.ressourcen.R
import ch.brickinventoryapp.ui.theme.BrickInventoryManagerTheme
import ch.brickinventoryapp.ui.util.LocalSdkLevel
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

/**
 * Der Einladungscode wie der TOTP-Schlüssel: Kopieren erst ab Android 13, wo das
 * System den Clip aus Vorschau und Tastaturverlauf heraushält. Darunter bleibt
 * Teilen; der Code geht ohnehin auf ein anderes Gerät.
 *
 * Gegenprobe (Patch unter gegenproben/, Robolectric, misst die CI):
 *   einladung-kopieren-vor-33  der Kopierknopf ohne secretCopyable() → rot „unter Android 13 …“
 */
@RunWith(RobolectricTestRunner::class)
class InvitationCopyTest {

    @get:Rule
    val compose = createAndroidComposeRule<ComponentActivity>()

    private val stufe = mutableStateOf(33)

    private fun text(id: Int) = compose.activity.getString(id)

    private fun buttons(id: Int) = compose.onAllNodes(hasText(text(id)) and hasClickAction()).fetchSemanticsNodes().size

    private fun zeige() {
        val status = HouseholdStatusView(isMain = true, isSub = false, currency = Waehrung("CHF"),
            elternkonten = emptyList(), subAccounts = emptyList(), openInvites = 1, formerLinks = emptyList())
        compose.setContent {
            BrickInventoryManagerTheme {
                // Wie in der Unterseite: eine rollbare Spalte.
                CompositionLocalProvider(LocalSdkLevel provides stufe.value) {
                    Column(Modifier.verticalScroll(rememberScrollState())) {
                        HouseholdCard(HouseholdUiState(status = status, inviteCode = "ABCD-1234"),
                            onCreateInvite = {}, onRedeemInvite = { _, _, _ -> }, onUnlink = {}, onUnlinkParent = {},
                            onVerwerfen = {})
                    }
                }
            }
        }
        compose.waitForIdle()
    }

    @Test
    fun `unter Android 13 laesst sich der Code nur teilen, ab 13 auch geheim kopieren`() {
        stufe.value = 32
        zeige()
        assertEquals("Teilen bleibt", 1, buttons(R.string.household_invite_teilen))
        assertEquals("Unter Android 13 kein Kopierknopf", 0, buttons(R.string.household_invite_copy))

        stufe.value = 33
        compose.waitForIdle()
        compose.onNode(hasText(text(R.string.household_invite_copy)) and hasClickAction()).performScrollTo().performClick()
        compose.waitForIdle()
        val clip = compose.activity.getSystemService(ClipboardManager::class.java).primaryClip
        assertEquals("ABCD-1234", clip?.getItemAt(0)?.text?.toString())
        assertEquals(true, clip?.description?.extras?.getBoolean("android.content.extra.IS_SENSITIVE"))
    }
}
