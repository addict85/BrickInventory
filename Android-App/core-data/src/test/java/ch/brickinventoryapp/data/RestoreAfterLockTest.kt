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
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import java.io.File

/**
 * Screen off wipes the token from the interceptor's mirror; a request while the device is still
 * locked asks to restore it. The keystore stays locked longer than readToken's start-up attempts,
 * so readToken reports "" once. That "" must not become the token: after unlocking, the mirror
 * has to hold the real token again, not "signed out" for the rest of the process.
 *
 * Counter-check (Robolectric, local, Nov 26, 2026):
 *   restoreAfterLock() back to `val token = authToken.first()` (no LockedState check) → red
 *   „locked, the mirror keeps the placeholder …“ (mirror was "") ; counter-checks/restore-after-lock-takes-empty.patch
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35])
class RestoreAfterLockTest {

    /** Like the Keystore under setUnlockedDeviceRequired: locked, it answers LockedState. */
    private class LockableVault : TokenEncryption {
        @Volatile var locked = false
        override fun encrypt(plaintext: String) = "ENC($plaintext)"
        override fun decrypt(saved: String) = saved.removePrefix("ENC(").removeSuffix(")")
        override fun open(saved: String): VaultFinding {
            return if (locked) VaultFinding.LockedState else VaultFinding.Readable(decrypt(saved))
        }
    }

    private val ctx = ApplicationProvider.getApplicationContext<Context>()
    private val areas = mutableListOf<CoroutineScope>()
    private val store = PreferenceDataStoreFactory.create { File(ctx.filesDir, "restore-${System.nanoTime()}.preferences_pb") }
    private val wipe = LockWipe()
    private val vault = LockableVault()

    @After
    fun tearDown() = areas.forEach { it.cancel() }

    private fun signedIn(): TokenStore {
        val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO).also { areas += it }
        val p = TokenStore(store, vault, DevicesStore(ctx, store, testTrustCipher()), scope, wipe,
            lock = DeviceLock { vault.locked })
        p.waitOnStart()
        runBlocking { p.saveServerUrl("https://brick.example"); p.saveAuthToken("tok-a") }
        return p
    }

    private fun waitFor(p: TokenStore, value: String) =
        runBlocking { withTimeout(10_000) { while (p.authTokenState.value != value) delay(10) } }

    @Test
    fun `a restore while the keystore is locked does not sign out, unlocking brings the token back`() {
        val p = signedIn()
        vault.locked = true
        wipe.wipe()
        waitFor(p, TokenStore.TOKEN_WIPED)

        // A request while locked (ServerClient.token()); readToken gives up its start-up attempts after ~4.5 s.
        // Watched for longer than those attempts: other readers open the vault too, so counting
        // opens does not tell when this restore has decided.
        p.restoreAfterLock()
        val deadline = System.currentTimeMillis() + 7_000
        while (System.currentTimeMillis() < deadline) {
            assertNotEquals("locked, the mirror keeps the placeholder instead of reading as signed out",
                "", p.authTokenState.value)
            runBlocking { delay(20) }
        }

        // Unlocked: ACTION_USER_PRESENT → LockWipe.restore().
        vault.locked = false
        wipe.restore()
        waitFor(p, "tok-a")
        assertEquals("tok-a", runBlocking { p.tokenNow() })
    }
}
