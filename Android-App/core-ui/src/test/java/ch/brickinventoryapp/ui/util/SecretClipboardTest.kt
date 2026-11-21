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
 * What the app copies as secrets carries the marker that Android 13
 * reads: no content preview, no keyboard suggestion. After a
 * minute it is gone again — only if our clip is still there.
 *
 * Counter-checks (Robolectric, measurable only in CI; job `gegenproben`):
 *   (a) the line with IS_SECRET removed from secretClip() → red (intended)
 *   (b) the LEEREN branch in SecretClipboard.pruefe() has no effect → red
 *       „ein kopiertes Geheimnis ist nach einer Minute weg …“
 *       (gegenproben/zwischenablage-leert-nicht.patch)
 */
@RunWith(RobolectricTestRunner::class)
class SecretClipboardTest {

    @Test
    fun `a secret is marked as sensitive for the system`() {
        val clip = secretClip("BrickInventory", "4711")
        assertEquals("4711", clip.getItemAt(0).text.toString())
        assertEquals(ClipDescription.EXTRA_IS_SENSITIVE, IS_SECRET)
        assertTrue(clip.description.extras.getBoolean(ClipDescription.EXTRA_IS_SENSITIVE))
    }

    @Test
    fun `a copied secret is gone after one minute, foreign content stays`() {
        val ctx = ApplicationProvider.getApplicationContext<Context>()
        val ablage = ctx.getSystemService(ClipboardManager::class.java)
        fun inhalt() = ablage.primaryClip?.takeIf { it.itemCount > 0 }?.getItemAt(0)?.text?.toString().orEmpty()

        SecretClipboard.copy(ctx, "BrickInventory", "4711")
        ShadowLooper.idleMainLooper(59, TimeUnit.SECONDS)
        assertEquals("Vor Ablauf noch da", "4711", inhalt())
        ShadowLooper.idleMainLooper(2, TimeUnit.SECONDS)
        assertEquals("Nach einer Minute leer", "", inhalt())

        SecretClipboard.copy(ctx, "BrickInventory", "4711")
        ablage.setPrimaryClip(ClipData.newPlainText("Notiz", "fremd"))
        ShadowLooper.idleMainLooper(61, TimeUnit.SECONDS)
        assertEquals("Fremder Inhalt bleibt", "fremd", inhalt())
    }
}
