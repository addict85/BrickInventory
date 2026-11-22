package ch.brickinventoryapp.app

import android.app.KeyguardManager
import android.content.Context
import androidx.core.content.edit
import androidx.test.core.app.ApplicationProvider
import ch.brickinventoryapp.ui.components.AppLock
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows.shadowOf
import javax.crypto.Mac
import javax.crypto.spec.SecretKeySpec

/**
 * The lock state on disk is sealed: whoever edits the file to „unlocked“ or „off“ gets a
 * locked app, and a switched-off lock comes back. A state of an older version without
 * a seal is taken over once; regular writes keep the seal intact.
 *
 * Counter-checks (Robolectric, local):
 *   A  checkSeal() without the comparison (always `return`) → red „an edited file to unlocked …“,
 *      „a lock switched off in the file …“ and „a state of an older version …“
 *   B  in the tamper branch `putBoolean(LOCKED, true)` removed → red, the same three
 *   C  the first-run branch without `!seal.exists()` → red „a state of an older version …“
 */
@RunWith(RobolectricTestRunner::class)
class AppLockSealTest {

    private val ctx = ApplicationProvider.getApplicationContext<Context>()
    private val file get() = ctx.getSharedPreferences("app_sperre", Context.MODE_PRIVATE)

    /** Software HMAC instead of the Keystore; [made] like a key that already exists. */
    private class SoftwareSeal(var made: Boolean = false) : LockSeal {
        private val key = SecretKeySpec(ByteArray(32) { 7 }, "HmacSHA256")
        override fun exists() = made
        override fun mac(data: ByteArray): ByteArray = Mac.getInstance("HmacSHA256").run { made = true; init(key); doFinal(data) }
    }

    private val seal = SoftwareSeal()

    @Before
    fun secure() {
        shadowOf(ctx.getSystemService(KeyguardManager::class.java)).setIsDeviceSecure(true)
        file.edit(commit = true) { clear() }
    }

    private fun store() = AppLockStore(ctx, seal)

    @Test
    fun `regular writes keep the seal, a new instance reads the same state`() {
        store().apply { setMinutes(15); setLocked(false); rememberBackground(1234L) }
        val again = store()
        assertFalse(again.gesperrt())
        assertEquals(15, again.minuten())
        assertEquals(1234L, again.backgroundSince())
    }

    @Test
    fun `an edited file to unlocked locks the app`() {
        store().apply { setMinutes(5); setLocked(true) }
        file.edit(commit = true) { putBoolean("gesperrt", false) }
        assertTrue("Ein gebrochenes Siegel sperrt", store().gesperrt())
    }

    @Test
    fun `a lock switched off in the file comes back with the default`() {
        store().apply { setMinutes(5); setLocked(false) }
        file.edit(commit = true) { putInt("minuten", 0); remove("hintergrund_seit") }
        val s = store()
        assertTrue(s.gesperrt())
        assertEquals(AppLock.DEFAULT_MINUTES, s.minuten())
        s.setLocked(false)
        assertEquals("Nach dem Entsperren gilt das neue Siegel", false, store().gesperrt())
    }

    @Test
    fun `a state of an older version without a seal is taken over once`() {
        file.edit(commit = true) { putInt("minuten", 0); putBoolean("gesperrt", false) }
        val s = store()
        assertFalse("Ein Update sperrt nicht", s.gesperrt())
        assertEquals(0, s.minuten())
        file.edit(commit = true) { remove("siegel") }
        assertTrue("Danach zählt ein fehlendes Siegel als verändert", store().gesperrt())
    }
}
