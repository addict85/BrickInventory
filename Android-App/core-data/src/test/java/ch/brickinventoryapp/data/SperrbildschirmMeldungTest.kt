package ch.brickinventoryapp.data

import android.app.Notification
import android.content.Context
import androidx.core.app.NotificationCompat
import androidx.test.core.app.ApplicationProvider
import ch.brickinventoryapp.data.lokal.EntwertungsWorker
import ch.brickinventoryapp.ressourcen.R
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

/**
 * Meldungen nennen Server und Fortschritt nur entsperrt; auf dem Sperrbildschirm steht
 * eine Ersatzfassung mit dem Titel allein.
 *
 * Gegenproben (Robolectric, nur in der CI messbar; Job `gegenproben`):
 *   abmeldung-meldung-oeffentlich  nurEntsperrt() aus EntwertungsWorker.meldung() gestrichen
 *                                  → rot „die gescheiterte Abmeldung nennt den Server …“
 *   sperrbildschirm-mit-text       die Ersatzfassung übernimmt den Text → rot „die Ersatzfassung …“
 */
@RunWith(RobolectricTestRunner::class)
class SperrbildschirmMeldungTest {

    private val ctx = ApplicationProvider.getApplicationContext<Context>()

    private fun sichtbar(n: Notification?) = listOf(Notification.EXTRA_TITLE, Notification.EXTRA_TEXT, Notification.EXTRA_BIG_TEXT)
        .joinToString(" ") { n?.extras?.getCharSequence(it)?.toString().orEmpty() }

    @Test
    fun `die gescheiterte Abmeldung nennt den Server nur entsperrt`() {
        val n = EntwertungsWorker.meldung(ctx, "brick.example:8443")
        assertEquals(Notification.VISIBILITY_PRIVATE, n.visibility)
        assertNotNull("Ohne Ersatzfassung zeigt Android je nach Einstellung alles", n.publicVersion)
        assertFalse(sichtbar(n.publicVersion), "brick.example" in sichtbar(n.publicVersion))
        assertEquals(ctx.getString(R.string.abmeldung_gescheitert_titel),
            n.publicVersion.extras.getCharSequence(Notification.EXTRA_TITLE).toString())
        assertTrue("Entsperrt steht der Server in der Meldung", "brick.example" in sichtbar(n))
    }

    @Test
    fun `die Ersatzfassung traegt nur den Titel`() {
        val n = NotificationCompat.Builder(ctx, "probe").setSmallIcon(android.R.drawable.ic_dialog_info)
            .setContentTitle("Import").setContentText("Set 75192-1 von brick.example")
            .nurEntsperrt(ctx, "probe", "Import", android.R.drawable.ic_dialog_info).build()
        assertEquals(Notification.VISIBILITY_PRIVATE, n.visibility)
        assertEquals("Import", sichtbar(n.publicVersion).trim())
    }
}
