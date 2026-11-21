package ch.brickinventoryapp.app

import android.content.ComponentName
import android.content.Intent
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.compose.ui.test.junit4.v2.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.core.net.toUri
import androidx.navigation.NavController
import androidx.navigation.NavHostController
import androidx.navigation.compose.ComposeNavigator
import androidx.navigation.compose.composable
import androidx.navigation.createGraph
import ch.brickinventoryapp.services.alarm.PreisalarmWorker
import ch.brickinventoryapp.resources.R
import ch.brickinventoryapp.state.ui.Meldungseingang
import ch.brickinventoryapp.app.ui.components.UserCaDialog
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
import ch.brickinventoryapp.data.service.TeilelistenProvider
import ch.brickinventoryapp.data.service.partListsSelection
import ch.brickinventoryapp.ui.components.Ueberdeckungsschutz
import androidx.core.content.IntentCompat

/**
 * What a foreign app can reach: the notification entry not at all, the
 * exported MainActivity only without a target. Plus the confirmation for user CAs with
 * protection against overlaid windows (tapjacking).
 *
 * Counter-checks (Robolectric, measurable only in CI; job `gegenproben`):
 *   (a) MeldungsEinstieg exported="true" → red “the entry point of the notifications is
 *       not exported” (gegenproben/einstieg-exportiert.patch)
 *   (b) Ueberdeckungsschutz() removed from UserCaDialog → red “the confirmation
 *       …” (gegenproben/nutzerca-ohne-ueberdeckungsschutz.patch)
 *   (c) forwardMessage() attaches the extra to the app's start → red “the
 *       own notification opens its set …” (gegenproben/einstieg-reicht-extra-durch.patch)
 *   (d) Ueberdeckungsschutz() does not reset when leaving → red “a
 *       protected screen protects the activity only while it is shown”
 *       (gegenproben/ueberdeckung-bleibt-an.patch)
 *   (e) OnlyLauncherStart.onCreate removes nothing any more → red “a foreign
 *       start …” (gegenproben/start-behaelt-extras.patch)
 *   (f) removeForeignDetails() leaves the extras → red “without extras
 *       a foreign deep link …” and “a foreign start …” (gegenproben/extras-bleiben.patch)
 *   (g) partListsSelection() returns the view without createChooser → red
 *       “the parts list goes out only via the system's chooser” (gegenproben/teileliste-ohne-auswahl.patch)
 */
@RunWith(RobolectricTestRunner::class)
class ForeignEntryTest {

    @get:Rule
    val compose = createAndroidComposeRule<ComponentActivity>()

    private val ctx get() = compose.activity

    @Test
    fun `the entry point of the notifications is not exported`() {
        val pm = ctx.packageManager
        assertFalse(pm.getActivityInfo(ComponentName(ctx, MeldungsEinstieg::class.java), 0).exported)
        assertTrue("Der Launcher braucht MainActivity", pm.getActivityInfo(ComponentName(ctx, MainActivity::class.java), 0).exported)
    }

    @Test
    fun `the own notification opens its set, the app gets no extras`() {
        val inbox = Meldungseingang()
        val weiter = forwardMessage(ctx, Intent().putExtra(PreisalarmWorker.EXTRA_SET, "75192-1"), inbox)
        assertEquals(MainActivity::class.java.name, weiter.component?.className)
        assertNull("MainActivity liest keine Extras; es gibt auch keine", weiter.extras)
        assertEquals("75192-1", inbox.abholen())
    }

    @Test
    fun `an invalid or missing target opens nothing, the app starts anyway`() {
        val inbox = Meldungseingang()
        for (arrival in listOf(null, Intent(), Intent().putExtra(PreisalarmWorker.EXTRA_SET, "1/../konto"))) {
            val weiter = forwardMessage(ctx, arrival, inbox)
            assertEquals(MainActivity::class.java.name, weiter.component?.className)
            assertNull(inbox.abholen())
        }
    }

    @Test
    fun `the confirmation is protected against overlays and passes the yes on`() {
        var ja = 0
        var nein = 0
        compose.setContent { BrickInventoryManagerTheme { UserCaDialog(onJa = { ja++ }, onAbbrechen = { nein++ }) } }
        compose.waitForIdle()
        val dialog = ShadowDialog.getLatestDialog()
        assertTrue("Berührungen durch ein fremdes Fenster kämen an", dialog.window!!.decorView.filterTouchesWhenObscured)
        compose.onNodeWithText(ctx.getString(R.string.nutzer_ca_frage_ja)).performClick()
        assertEquals(1, ja)
        assertEquals(0, nein)
    }

    @Test
    fun `a protected screen protects the activity only while it is shown`() {
        val zeigen = androidx.compose.runtime.mutableStateOf(true)
        compose.setContent { if (zeigen.value) Ueberdeckungsschutz() }
        compose.waitForIdle()
        val fenster = compose.activity.window.decorView
        assertTrue("Berührungen durch ein fremdes Fenster kämen an", fenster.filterTouchesWhenObscured)
        zeigen.value = false
        compose.waitForIdle()
        assertFalse("Nach dem Bildschirm bleibt die übrige App ohne", fenster.filterTouchesWhenObscured)
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
        val offen = navigation()
        assertTrue("Ohne Entfernen springt der fremde Start ins Ziel", offen.handleDeepLink(attack(offen)))
        assertEquals("konto", offen.currentDestination?.route)

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
        assertNull("Extras beim Start", probe.get().gesehen?.extras)
        assertNull("Daten beim Start", probe.get().gesehen?.data)

        probe.start().resume().newIntent(attack(nav).setClass(ctx, ProbeStart::class.java))
        assertNull("Extras bei onNewIntent", probe.get().neu?.extras)
        assertNull("Daten bei onNewIntent", probe.get().neu?.data)
        assertTrue("MainActivity entfernt nicht", OnlyLauncherStart::class.java.isAssignableFrom(MainActivity::class.java))
    }

    @Test
    fun `the parts list goes out only via the system's chooser`() {
        val selection = partListsSelection(ctx, "Teileliste")
        assertEquals("Ohne Auswahl bekäme die Standard-App das Inventar", Intent.ACTION_CHOOSER, selection.action)
        val ziel = IntentCompat.getParcelableExtra(selection, Intent.EXTRA_INTENT, Intent::class.java)!!
        assertEquals(Intent.ACTION_VIEW, ziel.action)
        assertEquals("content", ziel.data?.scheme)
        assertTrue("Ohne Leserecht öffnet keine App die Datei", (ziel.flags and Intent.FLAG_GRANT_READ_URI_PERMISSION) != 0)
        val provider = ctx.packageManager.resolveContentProvider(ziel.data!!.authority!!, 0)
        assertEquals("Die Uri zeigt auf den Teilelisten-Provider des Manifests",
            TeilelistenProvider::class.java.name, provider?.name)
        assertFalse("Der Teilelisten-Provider ist exportiert", provider!!.exported)
    }
}

/** Records what arrives at the own code after OnlyLauncherStart. */
class ProbeStart : OnlyLauncherStart() {
    var gesehen: Intent? = null
    var neu: Intent? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        gesehen = Intent(intent)
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        neu = Intent(intent)
    }
}
