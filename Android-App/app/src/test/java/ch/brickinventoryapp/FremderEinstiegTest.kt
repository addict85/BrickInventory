package ch.brickinventoryapp

import android.content.ComponentName
import android.content.Intent
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.core.net.toUri
import androidx.navigation.NavController
import androidx.navigation.NavHostController
import androidx.navigation.compose.ComposeNavigator
import androidx.navigation.compose.composable
import androidx.navigation.createGraph
import ch.brickinventoryapp.alarm.PreisalarmWorker
import ch.brickinventoryapp.ressourcen.R
import ch.brickinventoryapp.ui.Meldungseingang
import ch.brickinventoryapp.ui.components.NutzerCaDialog
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
import org.robolectric.annotation.Config
import org.robolectric.shadows.ShadowDialog

/**
 * Was eine fremde App erreichen kann: Den Einstieg der Meldungen gar nicht, die
 * exportierte MainActivity nur ohne Ziel. Dazu die Rückfrage für Nutzer-CAs mit
 * Schutz vor überlagerten Fenstern (Tapjacking).
 *
 * Gegenproben (Robolectric, nur in der CI messbar; Job `gegenproben`):
 *   (a) MeldungsEinstieg exported="true" → rot „der Einstieg der Meldungen ist
 *       nicht exportiert“ (gegenproben/einstieg-exportiert.patch)
 *   (b) Ueberdeckungsschutz() aus NutzerCaDialog entfernt → rot „die Rueckfrage
 *       …“ (gegenproben/nutzerca-ohne-ueberdeckungsschutz.patch)
 *   (c) meldungWeiterreichen() hängt das Extra an den Start der App → rot „die
 *       eigene Meldung oeffnet ihr Set …“ (gegenproben/einstieg-reicht-extra-durch.patch)
 *   (d) Ueberdeckungsschutz() setzt beim Verlassen nicht zurück → rot „ein
 *       geschuetzter Bildschirm schuetzt die Activity nur, solange er steht“
 *       (gegenproben/ueberdeckung-bleibt-an.patch)
 *   (e) NurLauncherStart.onCreate entfernt nichts mehr → rot „ein fremder
 *       Start …“ (gegenproben/start-behaelt-extras.patch)
 *   (f) fremdeAngabenEntfernen() lässt die Extras stehen → rot „ohne Extras
 *       navigiert …“ und „ein fremder Start …“ (gegenproben/extras-bleiben.patch)
 *   (g) teilelistenAuswahl() gibt die Ansicht ohne createChooser zurück → rot
 *       „die Teileliste geht nur ueber die Auswahl …“ (gegenproben/teileliste-ohne-auswahl.patch)
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35])
class FremderEinstiegTest {

    @get:Rule
    val compose = createAndroidComposeRule<ComponentActivity>()

    private val ctx get() = compose.activity

    @Test
    fun `der Einstieg der Meldungen ist nicht exportiert`() {
        val pm = ctx.packageManager
        assertFalse(pm.getActivityInfo(ComponentName(ctx, MeldungsEinstieg::class.java), 0).exported)
        assertTrue("Der Launcher braucht MainActivity", pm.getActivityInfo(ComponentName(ctx, MainActivity::class.java), 0).exported)
    }

    @Test
    fun `die eigene Meldung oeffnet ihr Set, die App bekommt keine Extras`() {
        val eingang = Meldungseingang()
        val weiter = meldungWeiterreichen(ctx, Intent().putExtra(PreisalarmWorker.EXTRA_SET, "75192-1"), eingang)
        assertEquals(MainActivity::class.java.name, weiter.component?.className)
        assertNull("MainActivity liest keine Extras; es gibt auch keine", weiter.extras)
        assertEquals("75192-1", eingang.abholen())
    }

    @Test
    fun `ein ungueltiges oder fehlendes Ziel oeffnet nichts, die App startet trotzdem`() {
        val eingang = Meldungseingang()
        for (ankunft in listOf(null, Intent(), Intent().putExtra(PreisalarmWorker.EXTRA_SET, "1/../konto"))) {
            val weiter = meldungWeiterreichen(ctx, ankunft, eingang)
            assertEquals(MainActivity::class.java.name, weiter.component?.className)
            assertNull(eingang.abholen())
        }
    }

    @Test
    fun `die Rueckfrage ist vor Ueberlagerung geschuetzt und reicht das Ja weiter`() {
        var ja = 0
        var nein = 0
        compose.setContent { BrickInventoryManagerTheme { NutzerCaDialog(onJa = { ja++ }, onAbbrechen = { nein++ }) } }
        compose.waitForIdle()
        val dialog = ShadowDialog.getLatestDialog()
        assertTrue("Berührungen durch ein fremdes Fenster kämen an", dialog.window!!.decorView.filterTouchesWhenObscured)
        compose.onNodeWithText(ctx.getString(R.string.nutzer_ca_frage_ja)).performClick()
        assertEquals(1, ja)
        assertEquals(0, nein)
    }

    @Test
    fun `ein geschuetzter Bildschirm schuetzt die Activity nur, solange er steht`() {
        val zeigen = androidx.compose.runtime.mutableStateOf(true)
        compose.setContent { if (zeigen.value) ch.brickinventoryapp.ui.components.Ueberdeckungsschutz() }
        compose.waitForIdle()
        val fenster = compose.activity.window.decorView
        assertTrue("Berührungen durch ein fremdes Fenster kämen an", fenster.filterTouchesWhenObscured)
        zeigen.value = false
        compose.waitForIdle()
        assertFalse("Nach dem Bildschirm bleibt die übrige App ohne", fenster.filterTouchesWhenObscured)
    }

    // Wie Navigation den Pfad zum Ziel im Start-Intent erwartet: Wurzelgraph, dann das Ziel.
    private fun angriff(nav: NavController) = Intent(Intent.ACTION_MAIN).apply {
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
    fun `ohne Extras navigiert ein fremder Deep-Link nicht`() {
        val offen = navigation()
        assertTrue("Ohne Entfernen springt der fremde Start ins Ziel", offen.handleDeepLink(angriff(offen)))
        assertEquals("konto", offen.currentDestination?.route)

        val nav = navigation()
        val bereinigt = angriff(nav).also { fremdeAngabenEntfernen(it) }
        assertFalse(nav.handleDeepLink(bereinigt))
        assertEquals("start", nav.currentDestination?.route)
    }

    @Test
    fun `ein fremder Start erreicht die Activity ohne Extras und Daten`() {
        val nav = navigation()
        val start = angriff(nav).setClass(ctx, ProbeStart::class.java)
        val probe = Robolectric.buildActivity(ProbeStart::class.java, start).create()
        assertNull("Extras beim Start", probe.get().gesehen?.extras)
        assertNull("Daten beim Start", probe.get().gesehen?.data)

        probe.start().resume().newIntent(angriff(nav).setClass(ctx, ProbeStart::class.java))
        assertNull("Extras bei onNewIntent", probe.get().neu?.extras)
        assertNull("Daten bei onNewIntent", probe.get().neu?.data)
        assertTrue("MainActivity entfernt nicht", NurLauncherStart::class.java.isAssignableFrom(MainActivity::class.java))
    }

    @Test
    fun `die Teileliste geht nur ueber die Auswahl des Systems hinaus`() {
        val datei = java.io.File(ctx.filesDir, "pdf/teileliste.pdf").apply { parentFile!!.mkdirs(); writeText("Inventar") }
        val auswahl = ch.brickinventoryapp.service.teilelistenAuswahl(ctx, datei, "Teileliste")
        assertEquals("Ohne Auswahl bekäme die Standard-App das Inventar", Intent.ACTION_CHOOSER, auswahl.action)
        val ziel = androidx.core.content.IntentCompat.getParcelableExtra(auswahl, Intent.EXTRA_INTENT, Intent::class.java)!!
        assertEquals(Intent.ACTION_VIEW, ziel.action)
        assertEquals("content", ziel.data?.scheme)
        assertTrue("Ohne Leserecht öffnet keine App die Datei", (ziel.flags and Intent.FLAG_GRANT_READ_URI_PERMISSION) != 0)
    }
}

/** Hält fest, was nach NurLauncherStart beim eigenen Code ankommt. */
class ProbeStart : NurLauncherStart() {
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
