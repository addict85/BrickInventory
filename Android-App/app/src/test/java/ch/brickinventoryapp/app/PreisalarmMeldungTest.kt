package ch.brickinventoryapp.app

import android.app.Notification
import androidx.test.core.app.ApplicationProvider
import ch.brickinventoryapp.dienste.alarm.PreisalarmWorker
import ch.brickinventoryapp.ressourcen.R
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import android.content.Context

/**
 * Ein Preisalarm nennt Set und Preis nur entsperrt; auf dem Sperrbildschirm steht
 * eine Ersatzfassung ohne beides.
 *
 * Gegenprobe (Robolectric, nur in der CI messbar; Job `gegenproben`):
 *   setVisibility(VISIBILITY_PRIVATE) und setPublicVersion() entfernt → rot
 *   „auf dem Sperrbildschirm …“ (gegenproben/preisalarm-oeffentlich.patch)
 */
@RunWith(RobolectricTestRunner::class)
class PreisalarmMeldungTest {

    private val ctx = ApplicationProvider.getApplicationContext<Context>()

    @Test
    fun `auf dem Sperrbildschirm stehen weder Set noch Preis`() {
        val n = PreisalarmWorker.meldung(ctx, "75192-1: CHF 612.00 (unter CHF 650.00)", null)
        assertEquals(Notification.VISIBILITY_PRIVATE, n.visibility)
        val oeffentlich = n.publicVersion
        assertNotNull("Ohne Ersatzfassung zeigt Android nur „Inhalt ausgeblendet“ oder alles", oeffentlich)
        val sichtbar = listOf(Notification.EXTRA_TITLE, Notification.EXTRA_TEXT)
            .joinToString(" ") { oeffentlich!!.extras.getCharSequence(it)?.toString().orEmpty() }
        assertFalse(sichtbar, sichtbar.contains("75192") || sichtbar.contains("612"))
        assertEquals(ctx.getString(R.string.alert_gesperrt), oeffentlich!!.extras.getCharSequence(Notification.EXTRA_TEXT).toString())
    }
}
