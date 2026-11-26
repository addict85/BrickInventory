package ch.brickinventoryapp.data

import android.content.Context
import androidx.datastore.preferences.core.PreferenceDataStoreFactory
import androidx.test.core.app.ApplicationProvider
import ch.brickinventoryapp.data.testing.testTrustCipher
import ch.brickinventoryapp.model.util.LockWipe
import ch.brickinventoryapp.security.DeviceLock
import ch.brickinventoryapp.security.TokenEncryption
import ch.brickinventoryapp.security.VaultFinding
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import kotlinx.coroutines.withTimeoutOrNull
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import java.io.File
import java.util.concurrent.CopyOnWriteArrayList

/**
 * A process started while the device is locked (widget, worker) reports "" after the start-up
 * attempts; the next attempt would come only after VAULT_FOLLOW_UP_MS (30 s). The unlock must
 * wake that retry at once, otherwise the sign-in screen stays up to 30 s after unlocking.
 *
 * Counter-check (Robolectric, local, Nov 26, 2026):
 *   the unlock does not wake the pause (`wait = pauseUntilUnlock` → `{ delay(it) }` in authToken and
 *   in the token mirror) → red „the unlock wakes the token read instead of waiting 30 s“ (still [""] after 5 s);
 *   counter-checks/unlock-does-not-wake-token-read.patch
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35])
class UnlockWakesReadTest {

    private class LockableVault : TokenEncryption {
        @Volatile var locked = false
        override fun encrypt(plaintext: String) = "ENC($plaintext)"
        override fun decrypt(saved: String) = saved.removePrefix("ENC(").removeSuffix(")")
        override fun open(saved: String): VaultFinding =
            if (locked) VaultFinding.LockedState else VaultFinding.Readable(decrypt(saved))
    }

    private val ctx = ApplicationProvider.getApplicationContext<Context>()
    private val areas = mutableListOf<CoroutineScope>()
    private val store = PreferenceDataStoreFactory.create { File(ctx.filesDir, "wake-${System.nanoTime()}.preferences_pb") }
    private val vault = LockableVault()

    @After
    fun tearDown() = areas.forEach { it.cancel() }

    private fun scope() = CoroutineScope(SupervisorJob() + Dispatchers.IO).also { areas += it }

    private fun start(wipe: LockWipe) =
        TokenStore(store, vault, DevicesStore(ctx, store, testTrustCipher()), scope(), wipe, lock = DeviceLock { vault.locked })

    @Test
    fun `the unlock wakes the token read of a process started while locked`() {
        start(LockWipe()).also { runBlocking { it.saveServerUrl("https://brick.example"); it.saveAuthToken("tok-a") } }

        // The new process starts while the device is locked.
        vault.locked = true
        val wipe = LockWipe()
        val p = start(wipe)
        val seen = CopyOnWriteArrayList<String>()
        scope().launch { p.authToken.collect { seen += it } }
        runBlocking { withTimeout(10_000) { while (seen.isEmpty()) delay(20) } }
        assertEquals("locked at start: the sign-in screen first", listOf(""), seen.toList())

        // Unlocked: ACTION_USER_PRESENT → LockWipe.restore().
        vault.locked = false
        wipe.restore()
        runBlocking {
            withTimeoutOrNull(5_000) { while (seen.lastOrNull() != "tok-a" || p.authTokenState.value != "tok-a") delay(20) }
        }
        assertEquals("the unlock wakes the token read instead of waiting 30 s", listOf("", "tok-a"), seen.toList())
        assertEquals("the unlock wakes the token mirror too", "tok-a", p.authTokenState.value)
    }
}
