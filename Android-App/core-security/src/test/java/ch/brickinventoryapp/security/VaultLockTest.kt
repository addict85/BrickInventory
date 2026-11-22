package ch.brickinventoryapp.security

import android.security.keystore.KeyPermanentlyInvalidatedException
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.security.InvalidKeyException
import java.security.KeyStoreException
import java.security.ProviderException
import java.security.UnrecoverableKeyException
import javax.crypto.AEADBadTagException
import javax.crypto.BadPaddingException

/**
 * A temporary Keystore error must not trigger a sign-out. Until now
 * any exception during decryption resulted in „no token“, including a KeyStoreException during
 * startup or a stalled StrongBox chip.
 *
 * Counter-checks:
 *   A  vaultErrorPermanent() always true (the old state: every error = gone) →
 *      red „only a permanent error means token gone“ and „ein vorübergehender Fehler wird einmal wiederholt“
 *   B  openWithRetry() with `repeat(1)` → red „… wird einmal wiederholt“
 *   C  readToken() reports „“ immediately when locked (`report(old ?: ""); return`) →
 *      red „ein gesperrter Keystore beim Start …“ and „… nachgemeldet“
 *   D  readToken() stops after startup (`return` after the first „“) → red
 *      „ein länger gesperrter Keystore meldet das Token nach“
 * Counter-checks for the key that only works on an unlocked device (measured locally):
 *   E  readToken() counts every attempt (`attempt++` unconditionally) → red „bei gesperrtem Geraet wartet das Lesen …“
 * ; counter-checks/sperre-zaehlt-versuche.patch
 *   G  UnlockVault.open() always via `onlyUnlocked` → red „ein Geheimtext ohne Praefix …“
 * ; counter-checks/entsperrtresor-vergisst-altbestand.patch
 * That UnlockVault never falls back to the key without a condition is checked by StoreUnlockedTest.
 */
class VaultLockTest {

    @Test
    fun `only a permanent error means token gone`() {
        for (e in listOf(AEADBadTagException("tag"), BadPaddingException("x"),
                         KeyPermanentlyInvalidatedException("neu eingerichtet"),
                         UnrecoverableKeyException("x"), IllegalArgumentException("base64"))) {
            assertTrue("$e", vaultErrorPermanent(e))
        }
        for (e in listOf(KeyStoreException("beim Hochfahren"), ProviderException("StrongBox"),
                         InvalidKeyException("Keystore nicht bereit"), IllegalStateException("x"),
                         RuntimeException("x"))) {
            assertFalse("$e", vaultErrorPermanent(e))
        }
    }

    @Test
    fun `a temporary error is retried once, a permanent one is not`() {
        var n = 0
        assertEquals(VaultFinding.Readable("t"), openWithRetry {
            if (n++ == 0) throw KeyStoreException("kurz") else "t"
        })
        n = 0
        assertEquals(VaultFinding.LockedState, openWithRetry { n++; throw ProviderException("haengt") })
        assertEquals(2, n)
        n = 0
        assertEquals(VaultFinding.Gone, openWithRetry { n++; throw AEADBadTagException() })
        assertEquals("Kein zweiter Versuch bei einem falschen Schlüssel", 1, n)
        assertEquals(VaultFinding.Gone, openWithRetry { null })
    }

    /** Delivers [findings] in order, then always the last one. */
    private class Sequence(vararg findings: VaultFinding) : TokenEncryption {
        private val rest = ArrayDeque(findings.toList())
        override fun encrypt(plaintext: String) = plaintext
        override fun decrypt(saved: String): String? = null
        override fun open(saved: String): VaultFinding = if (rest.size > 1) rest.removeFirst() else rest.first()
    }

    private fun read(
        vault: TokenEncryption,
        old: String? = null,
        lock: DeviceLock = DeviceLock { false },
    ): Pair<List<String>, List<Long>> {
        val reported = mutableListOf<String>()
        val pauses = mutableListOf<Long>()
        runBlocking { readToken(vault, "geheim", old, report = { reported += it }, wait = { pauses += it }, lock = lock) }
        return reported to pauses
    }

    /**
     * Locked overnight: far more attempts than the retry window allows. Afterwards unlocked
     * and readable; the token must come back, otherwise the sign-in screen would be there in the morning.
     */
    @Test
    fun `with a locked device reading waits without a deadline and reports the token after unlocking`() {
        val night = VAULT_ATTEMPT_MS.size + VAULT_FOLLOW_UP_ATTEMPTS + 50
        var read = 0
        val vault = object : TokenEncryption {
            override fun encrypt(plaintext: String) = plaintext
            override fun decrypt(saved: String): String? = null
            override fun open(saved: String): VaultFinding =
                if (read++ < night) VaultFinding.LockedState else VaultFinding.Readable("token")
        }
        val (reported, pauses) = read(vault, lock = { read < night })
        assertEquals("Einmal leer, dann das Token", listOf("", "token"), reported)
        assertEquals(night, pauses.size)
    }

    private class Fake(val name: String, val locked: () -> Boolean = { false }) : TokenEncryption {
        override fun encrypt(plaintext: String): String {
            if (locked()) throw InvalidKeyException("Gerät gesperrt")
            return "$name(" + plaintext.reversed() + ")"
        }
        override fun decrypt(saved: String): String? =
            saved.takeIf { it.startsWith("$name(") }?.removePrefix("$name(")?.removeSuffix(")")?.reversed()
    }

    @Test
    fun `the unlock vault stores under the strict key and recognizes the legacy stock`() {
        val vault = UnlockVault(Fake("streng"), Fake("immer"))
        val secret = vault.encrypt("token")
        assertTrue(secret, secret.contains("streng("))
        assertFalse(vault.stale(secret))
        assertEquals(VaultFinding.Readable("token"), vault.open(secret))
    }

    @Test
    fun `a ciphertext without prefix stays readable via the old key`() {
        val vault = UnlockVault(Fake("streng"), Fake("immer"))
        assertEquals(VaultFinding.Readable("alt"), vault.open("immer(tla)"))
        assertTrue(vault.stale("immer(tla)"))
    }

    @Test
    fun `a locked keystore at start is waited for, without signing out`() {
        val (reported, pauses) = read(Sequence(VaultFinding.LockedState, VaultFinding.LockedState, VaultFinding.Readable("token")))
        assertEquals("Kein leeres Token vor dem echten", listOf("token"), reported)
        assertEquals(VAULT_ATTEMPT_MS.take(2), pauses)
        assertTrue("Der Anlauf bleibt unter der Wartezeit des Wächters (5 s)", VAULT_ATTEMPT_MS.sum() < 5_000)
    }

    @Test
    fun `a keystore locked for longer reports the token afterwards`() {
        val lock = Array<VaultFinding>(VAULT_ATTEMPT_MS.size + 3) { VaultFinding.LockedState }
        val (reported, pauses) = read(Sequence(*lock, VaultFinding.Readable("token")))
        assertEquals("Erst die Anmeldemaske, dann wieder angemeldet", listOf("", "token"), reported)
        assertEquals(VAULT_ATTEMPT_MS + List(3) { VAULT_FOLLOW_UP_MS }, pauses)
    }

    @Test
    fun `a permanently locked keystore gives up eventually, a missing key immediately`() {
        val (reported, pauses) = read(Sequence(VaultFinding.LockedState))
        assertEquals(listOf(""), reported)
        assertTrue("Höchstens zehn Minuten: ${pauses.sum()}", pauses.sum() <= 10 * 60_000L + VAULT_ATTEMPT_MS.sum())
        assertEquals(listOf("alt") to emptyList<Long>(), read(Sequence(VaultFinding.Gone), old = "alt"))
    }
}
