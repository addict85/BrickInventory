package ch.brickinventoryapp.app

import android.content.ComponentName
import android.content.Intent
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.compose.ui.test.junit4.v2.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.core.content.IntentCompat
import androidx.core.net.toUri
import androidx.navigation.NavController
import androidx.navigation.NavHostController
import androidx.navigation.compose.ComposeNavigator
import androidx.navigation.compose.composable
import androidx.navigation.createGraph
import ch.brickinventoryapp.app.ui.components.UserCaDialog
import ch.brickinventoryapp.data.service.PartListsProvider
import ch.brickinventoryapp.data.service.partListsSelection
import ch.brickinventoryapp.resources.R
import ch.brickinventoryapp.services.alarm.PriceAlarmWorker
import ch.brickinventoryapp.state.ui.MessageInbox
import ch.brickinventoryapp.ui.components.OverlayGuard
import ch.brickinventoryapp.ui.theme.BrickInventoryManagerTheme
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.shadows.ShadowDialog

/**
 * What a foreign app can reach: the notification entry not at all, the
 * exported MainActivity only without a target. Plus the confirmation for user CAs with
 * protection against overlaid windows (tapjacking).
 *
 * Counter-checks (Robolectric, measurable only in CI; job `counter-checks`):
 *   (a) MessageEntryPoint exported="true" → red “the entry point of the notifications is
 *       not exported” (counter-checks/einstieg-exportiert.patch)
 *   (b) OverlayGuard() removed from UserCaDialog → red “the confirmation
 *       …” (counter-checks/nutzerca-ohne-ueberdeckungsschutz.patch)
 *   (c) forwardMessage() attaches the extra to the app's start → red “the
 *       own notification opens its set …” (counter-checks/einstieg-reicht-extra-durch.patch)
 *   (d) OverlayGuard() does not reset when leaving → red “a
 *       protected screen protects the activity only while it is shown”
 *       (counter-checks/ueberdeckung-bleibt-an.patch)
 *   (e) OnlyLauncherStart.onCreate removes nothing any more → red “a foreign
 *       start …” (counter-checks/start-behaelt-extras.patch)
 *   (f) removeForeignDetails() leaves the extras → red “without extras
 *       a foreign deep link …” and “a foreign start …” (counter-checks/extras-bleiben.patch)
 *   (g) partListsSelection() returns the view without createChooser → red
 *       “the parts list goes out only via the system's chooser” (counter-checks/teileliste-ohne-auswahl.patch)
 */
@RunWith(RobolectricTestRunner::class)
class ForeignEntryTest {

    @get:Rule
    val compose = createAndroidComposeRule<ComponentActivity>()

    private val ctx get() = compose.activity

    @Test
    fun `the entry point of the notifications is not exported`() {
        val pm = ctx.packageManager
        assertFalse(pm.getActivityInfo(ComponentName(ctx, MessageEntryPoint::class.java), 0).exported)
        assertTrue("the launcher needs MainActivity", pm.getActivityInfo(ComponentName(ctx, MainActivity::class.java), 0).exported)
    }

    @Test
    fun `the own notification opens its set, the app gets no extras`() {
        val inbox = MessageInbox()
        val next = forwardMessage(ctx, Intent().putExtra(PriceAlarmWorker.EXTRA_SET, "75192-1"), inbox)
        assertEquals(MainActivity::class.java.name, next.component?.className)
        assertNull("MainActivity reads no extras; there are none either", next.extras)
        assertEquals("75192-1", inbox.pickUp())
    }

    @Test
    fun `an invalid or missing target opens nothing, the app starts anyway`() {
        val inbox = MessageInbox()
        for (arrival in listOf(null, Intent(), Intent().putExtra(PriceAlarmWorker.EXTRA_SET, "1/../konto"))) {
            val next = forwardMessage(ctx, arrival, inbox)
            assertEquals(MainActivity::class.java.name, next.component?.className)
            assertNull(inbox.pickUp())
        }
    }

    @Test
    fun `the confirmation is protected against overlays and passes the yes on`() {
        var yes = 0
        var no = 0
        compose.setContent { BrickInventoryManagerTheme { UserCaDialog(onYes = { yes++ }, onCancel = { no++ }) } }
        compose.waitForIdle()
        val dialog = ShadowDialog.getLatestDialog()
        assertTrue("touches through a foreign window would get through", dialog.window!!.decorView.filterTouchesWhenObscured)
        compose.onNodeWithText(ctx.getString(R.string.user_ca_question_yes)).performClick()
        assertEquals(1, yes)
        assertEquals(0, no)
    }

    @Test
    fun `a protected screen protects the activity only while it is shown`() {
        val show = androidx.compose.runtime.mutableStateOf(true)
        compose.setContent { if (show.value) OverlayGuard() }
        compose.waitForIdle()
        val window = compose.activity.window.decorView
        assertTrue("touches through a foreign window would get through", window.filterTouchesWhenObscured)
        show.value = false
        compose.waitForIdle()
        assertFalse("after the screen the rest of the app stays without", window.filterTouchesWhenObscured)
    }

    // How navigation expects the path to the target in the start intent: root graph, then the target.
    private fun attack(nav: NavController) = Intent(Intent.ACTION_MAIN).apply {
        putExtra(NavController.KEY_DEEP_LINK_IDS, intArrayOf(nav.graph.id, nav.graph.findNode("konto")!!.id))
        data = "android-app://androidx.navigation/konto".toUri()
    }

    private fun navigation() = NavHostController(ctx.applicationContext).apply {
        navigatorProvider.addNavigator(ComposeNavigator())
        graph = createGraph(startDestination = "start") {
            composable("start") {}
            composable("konto") {}
        }
    }

    @Test
    fun `without extras a foreign deep link does not navigate`() {
        val open = navigation()
        assertTrue("without removing, the foreign start jumps into the destination", open.handleDeepLink(attack(open)))
        assertEquals("konto", open.currentDestination?.route)

        val nav = navigation()
        val cleaned = attack(nav).also { removeForeignDetails(it) }
        assertFalse(nav.handleDeepLink(cleaned))
        assertEquals("start", nav.currentDestination?.route)
    }

    @Test
    fun `a foreign start reaches the activity without extras and data`() {
        val nav = navigation()
        val start = attack(nav).setClass(ctx, ProbeStart::class.java)
        val probe = Robolectric.buildActivity(ProbeStart::class.java, start).create()
        assertNull("Extras beim Start", probe.get().seen?.extras)
        assertNull("data at start", probe.get().seen?.data)

        probe.start().resume().newIntent(attack(nav).setClass(ctx, ProbeStart::class.java))
        assertNull("extras on onNewIntent", probe.get().newValue?.extras)
        assertNull("data on onNewIntent", probe.get().newValue?.data)
        assertTrue("MainActivity does not remove", OnlyLauncherStart::class.java.isAssignableFrom(MainActivity::class.java))
    }

    @Test
    fun `the parts list goes out only via the system's chooser`() {
        val selection = partListsSelection(ctx, "Teileliste")
        assertEquals("without a chooser the default app would get the inventory", Intent.ACTION_CHOOSER, selection.action)
        val target = IntentCompat.getParcelableExtra(selection, Intent.EXTRA_INTENT, Intent::class.java)!!
        assertEquals(Intent.ACTION_VIEW, target.action)
        assertEquals("content", target.data?.scheme)
        assertTrue("without read permission no app opens the file", (target.flags and Intent.FLAG_GRANT_READ_URI_PERMISSION) != 0)
        val provider = ctx.packageManager.resolveContentProvider(target.data!!.authority!!, 0)
        assertEquals("the Uri points to the manifest's parts list provider",
            PartListsProvider::class.java.name, provider?.name)
        assertFalse("the parts list provider is exported", provider!!.exported)
    }
}

/** Records what arrives at the own code after OnlyLauncherStart. */
class ProbeStart : OnlyLauncherStart() {
    var seen: Intent? = null
    var newValue: Intent? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        seen = Intent(intent)
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        newValue = Intent(intent)
    }
}
