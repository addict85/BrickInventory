package ch.brickinventoryapp.app

import android.app.Notification
import android.content.Context
import androidx.test.core.app.ApplicationProvider
import ch.brickinventoryapp.resources.R
import ch.brickinventoryapp.services.alarm.PriceAlarmWorker
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

/**
 * A price alert names set and price only when unlocked; on the lock screen a
 * public version without either stands.
 *
 * Counter-check (Robolectric, measurable only in CI; job `counter-checks`):
 *   setVisibility(VISIBILITY_PRIVATE) and setPublicVersion() removed → red
 *   “on the lock screen …” (counter-checks/preisalarm-oeffentlich.patch)
 */
@RunWith(RobolectricTestRunner::class)
class PriceAlertMessageTest {

    private val ctx = ApplicationProvider.getApplicationContext<Context>()

    @Test
    fun `on the lock screen neither set nor price is shown`() {
        val n = PriceAlarmWorker.message(ctx, "75192-1: CHF 612.00 (unter CHF 650.00)", null)
        assertEquals(Notification.VISIBILITY_PRIVATE, n.visibility)
        val public = n.publicVersion
        assertNotNull("Ohne Ersatzfassung zeigt Android nur „Inhalt ausgeblendet“ oder alles", public)
        val visible = listOf(Notification.EXTRA_TITLE, Notification.EXTRA_TEXT)
            .joinToString(" ") { public!!.extras.getCharSequence(it)?.toString().orEmpty() }
        assertFalse(visible, visible.contains("75192") || visible.contains("612"))
        assertEquals(ctx.getString(R.string.alert_locked), public!!.extras.getCharSequence(Notification.EXTRA_TEXT).toString())
    }
}
