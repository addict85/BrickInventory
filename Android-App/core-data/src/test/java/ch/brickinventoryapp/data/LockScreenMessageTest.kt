package ch.brickinventoryapp.data

import android.app.Notification
import android.content.Context
import androidx.core.app.NotificationCompat
import androidx.test.core.app.ApplicationProvider
import ch.brickinventoryapp.data.local.RedemptionWorker
import ch.brickinventoryapp.resources.R
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

/**
 * Notifications name server and progress only when unlocked; on the lock screen there is
 * a public version with the title alone.
 *
 * Counter-checks (Robolectric, only measurable in CI; job `counter-checks`):
 *   abmeldung-meldung-oeffentlich  onlyUnlocked() struck from RedemptionWorker.message()
 *                                  → red “the failed sign-out names the server …”
 *   sperrbildschirm-mit-text       the public version takes over the text → red “the public version …”
 */
@RunWith(RobolectricTestRunner::class)
class LockScreenMessageTest {

    private val ctx = ApplicationProvider.getApplicationContext<Context>()

    private fun visible(n: Notification?) = listOf(Notification.EXTRA_TITLE, Notification.EXTRA_TEXT, Notification.EXTRA_BIG_TEXT)
        .joinToString(" ") { n?.extras?.getCharSequence(it)?.toString().orEmpty() }

    @Test
    fun `the failed sign-out names the server only when unlocked`() {
        val n = RedemptionWorker.message(ctx, "brick.example:8443")
        assertEquals(Notification.VISIBILITY_PRIVATE, n.visibility)
        assertNotNull("Without a public version Android shows everything, depending on the setting", n.publicVersion)
        assertFalse(visible(n.publicVersion), "brick.example" in visible(n.publicVersion))
        assertEquals(ctx.getString(R.string.logout_failed_title),
            n.publicVersion.extras.getCharSequence(Notification.EXTRA_TITLE).toString())
        assertTrue("Unlocked, the server stands in the notification", "brick.example" in visible(n))
    }

    @Test
    fun `the public version carries only the title`() {
        val n = NotificationCompat.Builder(ctx, "probe").setSmallIcon(android.R.drawable.ic_dialog_info)
            .setContentTitle("Import").setContentText("Set 75192-1 von brick.example")
            .onlyUnlocked(ctx, "probe", "Import", android.R.drawable.ic_dialog_info).build()
        assertEquals(Notification.VISIBILITY_PRIVATE, n.visibility)
        assertEquals("Import", visible(n.publicVersion).trim())
    }
}
