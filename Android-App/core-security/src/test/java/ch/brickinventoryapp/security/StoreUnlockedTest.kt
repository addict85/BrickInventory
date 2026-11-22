package ch.brickinventoryapp.security

import org.junit.After
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test
import java.io.File
import java.io.IOException
import java.util.Base64

/**
 * The store key (inventory, purchase prices, outbox) sits under the Keystore key that only
 * works unlocked (UnlockVault). A legacy entry under the key without a condition gets re-encrypted
 * on the first readable access, without a store ever becoming unreadable; while locked
 * no new key is created, and a store reports „locked“ instead of „unreadable“ (otherwise it would delete it).
 * Re-encryption only ever happens under the unlock condition, never with a fallback.
 *
 * Counter-checks (kotlinc and JUnit locally):
 *   A  in hole() `if (vault.stale(wrapped)) wrapNew(…)` removed → red „ein Altbestand … kommt beim ersten Lesen unter den entsperrten …“
 * ; counter-checks/ablage-bleibt-ohne-sperre.patch
 *   C  in StoreCipher.open() the key wrapped in runCatching again → red „gesperrt entsteht kein neuer Schluessel …“ (null instead of IOException); counter-checks/ablage-gesperrt-wie-unlesbar.patch
 *   D  UnlockVault.encrypt() falls back to the legacy key again → red
 *      „locked the unlock vault stores nothing under the weaker key“;
 *      counter-checks/entsperrtresor-mit-ausweg.patch
 *   E  erneuere() calls hole() without catchUnlessCancelled → red „Abmelden bei gesperrtem Geraet …“;
 *      counter-checks/ablage-erneuern-gesperrt-wirft.patch
 */
class StoreUnlockedTest {

    private val folder = File(System.getProperty("java.io.tmpdir"), "bim-entsperrt-${System.nanoTime()}").apply { mkdirs() }
    private val file = File(folder, "ablage.schluessel")

    /** What Ablageschluessel wrote: a result of the run, not source code. */
    private fun stored() = file.readBytes().decodeToString()

    @After
    fun tearDown() {
        folder.deleteRecursively()
    }

    /**
     * Like a Keystore key: a different ciphertext every time (as with a new IV), [locked] like
     * on a locked device, [broken]: encryption doesn't work.
     */
    private class ProbeVault(private val brand: String) : TokenEncryption {
        var locked = false
        var broken = false
        private var iv = 0
        override fun encrypt(plaintext: String): String {
            check(!locked && !broken) { "$brand not right now" }
            return brand + (iv++) + "." + Base64.getEncoder().encodeToString(plaintext.toByteArray())
        }
        override fun decrypt(saved: String): String? = (open(saved) as? VaultFinding.Readable)?.plaintext
        override fun open(saved: String): VaultFinding = when {
            locked -> VaultFinding.LockedState
            !saved.startsWith(brand) -> VaultFinding.Gone
            else -> VaultFinding.Readable(String(Base64.getDecoder().decode(saved.substringAfter("."))))
        }
    }

    private val unlocked = ProbeVault("n:")
    private val always = ProbeVault("i:")
    private fun newValue() = StoreKey(file, UnlockVault(unlocked, always))

    /** The state before this version: key under `brickinventory_ablage`, one store encrypted with it. */
    private fun legacyStock(): Pair<ByteArray, ByteArray> {
        val old = StoreKey(file, always)
        val secret = StoreCipher { old.forTarget("bestand") }.encrypt("Kaufpreis 499.99".toByteArray(), "b")
        return old.fetch() to secret
    }

    @Test
    fun `a legacy stock without condition goes under the unlocked one on first read, the stores stay readable`() {
        val (key, secret) = legacyStock()
        val k = newValue()
        assertArrayEquals("the same key, only wrapped differently", key, k.fetch())
        assertTrue("now under the key with an unlock condition", stored().startsWith(UNLOCKED_PREFIX + "n:"))
        assertFalse(k.newCreated)
        assertEquals("Kaufpreis 499.99", String(StoreCipher { newValue().forTarget("bestand") }.decrypt(secret, "b")!!))
    }

    @Test
    fun `locked no new key is created, the store reports locked instead of unreadable`() {
        val (_, secret) = legacyStock()
        newValue().fetch()
        val before = stored()
        unlocked.locked = true
        try {
            newValue().fetch()
            fail("locked, no key may come out")
        } catch (_: IOException) {
            // expected: Keystore not ready right now
        }
        assertEquals("nothing created anew", before, stored())
        try {
            StoreCipher { newValue().forTarget("bestand") }.decrypt(secret, "b")
            fail("locked would otherwise mean unreadable, and the store would be deleted")
        } catch (_: IOException) {
            // expected
        }
        unlocked.locked = false
        assertEquals("Kaufpreis 499.99", String(StoreCipher { newValue().forTarget("bestand") }.decrypt(secret, "b")!!))
    }

    @Test
    fun `if the unlocked vault cannot encrypt, the old one stays and keeps applying`() {
        val (key, _) = legacyStock()
        val before = stored()
        unlocked.broken = true
        assertArrayEquals(key, newValue().fetch())
        assertEquals("not rewritten without need", before, stored())
        unlocked.broken = false
        newValue().fetch()
        assertTrue("re-encrypted at the next start", stored().startsWith(UNLOCKED_PREFIX))
    }

    @Test
    fun `locked the unlock vault stores nothing under the weaker key`() {
        val vault = UnlockVault(unlocked, always)
        unlocked.locked = true
        try {
            vault.encrypt("neu-getauscht")
            fail("locked, no ciphertext may arise under the key without a condition")
        } catch (_: IllegalStateException) {
            // expected: the unlock key isn't working right now
        }
        unlocked.locked = false
        assertTrue(vault.encrypt("neu-getauscht").startsWith(UNLOCKED_PREFIX + "n:"))
    }

    @Test
    fun `sign-out with a locked device deletes the old key, the new one exists only when unlocked`() {
        val k = newValue()
        val old = k.fetch()
        unlocked.locked = true
        k.renew()
        assertFalse("the old key is gone", file.exists())
        try {
            k.fetch()
            fail("locked, no new key arises")
        } catch (_: IOException) {
            // expected: later
        }
        unlocked.locked = false
        assertFalse("a new key", old.contentEquals(k.fetch()))
        assertTrue(stored().startsWith(UNLOCKED_PREFIX + "n:"))
    }
}
