package ch.brickinventoryapp.ui.util

import android.content.ClipData
import android.content.ClipDescription
import android.content.ClipboardManager
import android.content.Context
import androidx.test.core.app.ApplicationProvider
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.shadows.ShadowLooper
import java.util.concurrent.TimeUnit

/**
 * Was die App an Geheimnissen kopiert, trägt die Markierung, die Android 13
 * auswertet: keine Vorschau des Inhalts, kein Tastaturvorschlag. Nach einer
 * Minute ist es wieder weg — nur wenn dort noch unser Clip liegt.
 *
 * Gegenproben (Robolectric, nur in der CI messbar; Job `gegenproben`):
 *   (a) in geheimerClip() die Zeile mit IST_GEHEIM entfernt → rot (vorgesehen)
 *   (b) in GeheimeZwischenablage.pruefe() der Zweig LEEREN ohne Wirkung → rot
 *       „ein kopiertes Geheimnis ist nach einer Minute weg …“
 *       (gegenproben/zwischenablage-leert-nicht.patch)
 */
@RunWith(RobolectricTestRunner::class)
class GeheimeZwischenablageTest {

    @Test
    fun `ein Geheimnis ist fuer das System als sensibel markiert`() {
        val clip = geheimerClip("BrickInventory", "4711")
        assertEquals("4711", clip.getItemAt(0).text.toString())
        assertEquals(ClipDescription.EXTRA_IS_SENSITIVE, IST_GEHEIM)
        assertTrue(clip.description.extras.getBoolean(ClipDescription.EXTRA_IS_SENSITIVE))
    }

    @Test
    fun `ein kopiertes Geheimnis ist nach einer Minute weg, fremder Inhalt bleibt`() {
        val ctx = ApplicationProvider.getApplicationContext<Context>()
        val ablage = ctx.getSystemService(ClipboardManager::class.java)
        fun inhalt() = ablage.primaryClip?.takeIf { it.itemCount > 0 }?.getItemAt(0)?.text?.toString().orEmpty()

        GeheimeZwischenablage.kopiere(ctx, "BrickInventory", "4711")
        ShadowLooper.idleMainLooper(59, TimeUnit.SECONDS)
        assertEquals("Vor Ablauf noch da", "4711", inhalt())
        ShadowLooper.idleMainLooper(2, TimeUnit.SECONDS)
        assertEquals("Nach einer Minute leer", "", inhalt())

        GeheimeZwischenablage.kopiere(ctx, "BrickInventory", "4711")
        ablage.setPrimaryClip(ClipData.newPlainText("Notiz", "fremd"))
        ShadowLooper.idleMainLooper(61, TimeUnit.SECONDS)
        assertEquals("Fremder Inhalt bleibt", "fremd", inhalt())
    }
}
