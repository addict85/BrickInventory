package ch.brickinventoryapp

import android.content.ComponentName
import android.content.Intent
import androidx.activity.ComponentActivity
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
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
}
