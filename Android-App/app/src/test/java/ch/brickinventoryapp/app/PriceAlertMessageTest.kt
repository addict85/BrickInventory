package ch.brickinventoryapp.app

import android.app.Notification
import androidx.test.core.app.ApplicationProvider
import ch.brickinventoryapp.services.alarm.PreisalarmWorker
import ch.brickinventoryapp.resources.R
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import android.content.Context

/**
 * A price alert names set and price only when unlocked; on the lock screen a
 * public version without either stands.
 *
 * Counter-check (Robolectric, measurable only in CI; job `gegenproben`):
 *   setVisibility(VISIBILITY_PRIVATE) and setPublicVersion() removed → red
 *   “on the lock screen …” (gegenproben/preisalarm-oeffentlich.patch)
 */
@RunWith(RobolectricTestRunner::class)
class PriceAlertMessageTest {

    private val ctx = ApplicationProvider.getApplicationContext<Context>()

    @Test
    fun `on the lock screen neither set nor price is shown`() {
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
