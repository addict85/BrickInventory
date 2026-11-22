package ch.brickinventoryapp.account

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
import ch.brickinventoryapp.account.ui.HouseholdUiState
import ch.brickinventoryapp.account.ui.screens.HouseholdCard
import ch.brickinventoryapp.model.domain.CurrencyCode
import ch.brickinventoryapp.model.domain.HouseholdStatusView
import ch.brickinventoryapp.resources.R
import ch.brickinventoryapp.ui.theme.BrickInventoryManagerTheme
import ch.brickinventoryapp.ui.util.LocalSdkLevel
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

/**
 * The invite code like the TOTP key: copying only from Android 13, where the
 * system keeps the clip out of the preview and keyboard history. Below that, sharing
 * remains; the code goes to a different device anyway.
 *
 * Counter-check (patch under counter-checks/, Robolectric, measured by CI):
 *   einladung-kopieren-vor-33  the copy button without secretCopyable() → red "unter Android 13 …"
 */
@RunWith(RobolectricTestRunner::class)
class InvitationCopyTest {

    @get:Rule
    val compose = createAndroidComposeRule<ComponentActivity>()

    private val level = mutableStateOf(33)

    private fun text(id: Int) = compose.activity.getString(id)

    private fun buttons(id: Int) = compose.onAllNodes(hasText(text(id)) and hasClickAction()).fetchSemanticsNodes().size

    private fun show() {
        val status = HouseholdStatusView(isMain = true, isSub = false, currency = CurrencyCode("CHF"),
            parentAccounts = emptyList(), subAccounts = emptyList(), openInvites = 1, formerLinks = emptyList())
        compose.setContent {
            BrickInventoryManagerTheme {
                // As in the subpage: a scrollable column.
                CompositionLocalProvider(LocalSdkLevel provides level.value) {
                    Column(Modifier.verticalScroll(rememberScrollState())) {
                        HouseholdCard(HouseholdUiState(status = status, inviteCode = "ABCD-1234"),
                            onCreateInvite = {}, onRedeemInvite = { _, _, _ -> }, onUnlink = {}, onUnlinkParent = {},
                            onDiscard = {})
                    }
                }
            }
        }
        compose.waitForIdle()
    }

    @Test
    fun `below Android 13 the code can only be shared, from 13 also copied secretly`() {
        level.value = 32
        show()
        assertEquals("Teilen bleibt", 1, buttons(R.string.household_invite_share))
        assertEquals("Unter Android 13 kein Kopierknopf", 0, buttons(R.string.household_invite_copy))

        level.value = 33
        compose.waitForIdle()
        compose.onNode(hasText(text(R.string.household_invite_copy)) and hasClickAction()).performScrollTo().performClick()
        compose.waitForIdle()
        val clip = compose.activity.getSystemService(ClipboardManager::class.java).primaryClip
        assertEquals("ABCD-1234", clip?.getItemAt(0)?.text?.toString())
        assertEquals(true, clip?.description?.extras?.getBoolean("android.content.extra.IS_SENSITIVE"))
    }
}
