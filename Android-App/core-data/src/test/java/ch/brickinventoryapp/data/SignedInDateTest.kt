package ch.brickinventoryapp.data

import android.content.Context
import androidx.datastore.preferences.core.PreferenceDataStoreFactory
import androidx.datastore.preferences.core.edit
import androidx.test.core.app.ApplicationProvider
import ch.brickinventoryapp.security.LockWipe
import ch.brickinventoryapp.security.TokenEncryption
import ch.brickinventoryapp.testing.testVertrauenschiffre
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import java.io.File

/**
 * The sign-in date decides when the app signs itself out. It lies sealed and bound to the
 * token: deleting, editing or copying it from another sign-in counts as expired instead of
 * restarting the clock. A swap carries the date over. Locked, the token leaves the mirror.
 *
 * Counter-checks (Robolectric, local):
 *   A  in loginExpired() `SignedIn.Missing -> false` → red „a deleted date …“, „a seal of
 *      another sign-in …“ and „a plaintext date …“ (after the transition)
 *   B  in signedInFrom() the tag comparison removed (`it.size == 2`) → red „a seal of another sign-in …“
 *   C  writeToken() without previousToken (date not carried over) → red „a swap keeps the date …“
 *   D  in signedInFrom() `minOf(alt, jetzt)` → `alt` → red „a plaintext date of older versions …“
 *   E  wipeTokenMirror() empty → red „locked the token leaves the mirror …“
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35])
class SignedInDateTest {

    private object Plain : TokenEncryption {
        override fun verschluessle(klartext: String) = "ENC($klartext)"
        override fun entschluessle(gespeichert: String) = gespeichert.removePrefix("ENC(").removeSuffix(")")
    }

    private val ctx = ApplicationProvider.getApplicationContext<Context>()
    private val areas = mutableListOf<CoroutineScope>()
    private val store = PreferenceDataStoreFactory.create { File(ctx.filesDir, "datum-${System.nanoTime()}.preferences_pb") }
    private val wipe = LockWipe()
    private val day = 24L * 60 * 60 * 1000

    private fun start(): TokenAblage {
        val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO).also { areas += it }
        return TokenAblage(store, Plain, DevicesStore(ctx, store, testVertrauenschiffre()), scope, wipe).also { it.waitOnStart() }
    }

    private fun signedIn(token: String = "tok-a"): TokenAblage = start().also {
        runBlocking { it.saveServerUrl("https://brick.example"); it.saveAuthToken(token) }
    }

    private fun disk() = runBlocking { store.data.first() }

    @After
    fun zu() = areas.forEach { it.cancel() }

    @Test
    fun `a fresh sign-in counts 90 days and lies sealed`() {
        val now = System.currentTimeMillis()
        val p = signedIn()
        assertFalse(runBlocking { p.loginExpired(now) })
        assertFalse(runBlocking { p.loginExpiresSoon(now) })
        assertTrue(runBlocking { p.loginExpiresSoon(now + 85 * day) })
        assertTrue(runBlocking { p.loginExpired(now + 91 * day) })
        assertNull("Kein Klartext-Datum mehr", disk()[TokenAblage.SIGNED_IN_AT])
        val sealed = disk()[TokenAblage.SIGNED_IN_SECRET]!!
        assertFalse("Das Datum steht nicht lesbar da", (now / 100_000).toString() in sealed)
    }

    @Test
    fun `a deleted date counts as expired instead of restarting the clock`() {
        val p = signedIn()
        runBlocking { store.edit { it.remove(TokenAblage.SIGNED_IN_SECRET) } }
        assertTrue(runBlocking { p.loginExpired(System.currentTimeMillis()) })
    }

    @Test
    fun `a seal of another sign-in does not count for this token`() {
        val p = signedIn("tok-a")
        val other = disk()[TokenAblage.SIGNED_IN_SECRET]!!
        runBlocking { p.saveAuthToken("tok-b") }
        runBlocking { store.edit { it[TokenAblage.SIGNED_IN_SECRET] = other } }
        assertTrue(runBlocking { p.loginExpired(System.currentTimeMillis()) })
    }

    @Test
    fun `a swap keeps the date of the sign-in`() {
        val now = System.currentTimeMillis()
        val p = signedIn()
        val before = runBlocking { p.tokenStatus() }
        assertTrue(runBlocking { p.replaceSwappedToken(before, "tok-neu", before.herkunft) })
        assertEquals("tok-neu", runBlocking { p.tokenJetzt() })
        assertFalse(runBlocking { p.loginExpired(now + 89 * day) })
        assertTrue("Der Tausch verlängert nichts", runBlocking { p.loginExpired(now + 91 * day) })
    }

    @Test
    fun `a plaintext date of older versions counts at most from now and is sealed`() {
        val now = System.currentTimeMillis()
        val p = signedIn()
        runBlocking {
            store.edit { it.remove(TokenAblage.SIGNED_IN_SECRET); it[TokenAblage.SIGNED_IN_AT] = now + 365 * day }
        }
        val legacyNow = minOf(now, TokenAblage.LEGACY_DATE_UNTIL - day)
        assertFalse(runBlocking { p.loginExpired(legacyNow) })
        assertTrue("Ein Datum in der Zukunft verlängert nichts", runBlocking { p.loginExpired(legacyNow + 91 * day) })
        assertNull(disk()[TokenAblage.SIGNED_IN_AT])
        runBlocking { store.edit { it.remove(TokenAblage.SIGNED_IN_SECRET); it[TokenAblage.SIGNED_IN_AT] = now } }
        assertTrue("Nach der Übergangszeit gilt nur das Siegel",
            runBlocking { p.loginExpired(TokenAblage.LEGACY_DATE_UNTIL + 1) })
    }

    @Test
    fun `locked the token leaves the mirror, unlocked it comes back`() {
        val p = signedIn()
        wipe.wipe()
        runBlocking { withTimeout(5_000) { while (p.authTokenState.value != TokenAblage.TOKEN_WIPED) delay(10) } }
        assertTrue("Angemeldet bleibt angemeldet", p.authTokenState.value!!.isNotBlank())
        assertEquals("Wer suspendiert fragt, liest von der Platte", "tok-a", runBlocking { p.tokenJetzt() })
        wipe.restore()
        runBlocking { withTimeout(5_000) { while (p.authTokenState.value != "tok-a") delay(10) } }
    }
}
