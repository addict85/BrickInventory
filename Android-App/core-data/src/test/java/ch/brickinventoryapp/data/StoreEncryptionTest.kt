package ch.brickinventoryapp.data

import ch.brickinventoryapp.security.StoreCipher
import ch.brickinventoryapp.security.StoreKey
import ch.brickinventoryapp.security.TokenEncryption
import ch.brickinventoryapp.security.VaultFinding
import org.junit.After
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test
import java.io.File
import java.io.IOException

/**
 * Local stores lie encrypted: widget and preview with AES-GCM, the
 * stock with SQLCipher; the shared key only wrapped by the keystore. Here
 * a dummy stands in for the keystore that visibly changes the plaintext;
 * SQLCipher itself runs only on the device.
 *
 * Counter-checks:
 *   B  StoreKey.hole() creates a new key on Gesperrt (as on
 *      Weg) → red “a locked keystore does not replace the key”
 *   C  StoreKey.forTarget() returns the shared key instead of a
 *      derived one → red “the key is created once …” and “plaintext
 *      and foreign data do not count” (widget and cache shared a key)
 *   D  in StoreCipher both `updateAAD(…)` struck → red “a
 *      file under a foreign name does not count”; counter-checks/store-without-binding.patch
 *   F in erneuere() `known = null` struck →
 *      red “after renewal everything old is unreadable …”
 */
class StoreEncryptionTest {

    private val folder = File(System.getProperty("java.io.tmpdir"), "bim-ablage-${System.nanoTime()}").apply { mkdirs() }

    @After
    fun tearDown() {
        folder.deleteRecursively()
    }

    /** Like the keystore: changes the text reversibly; [situation] controls what open() reports. */
    private class Vault : TokenEncryption {
        var situation: VaultFinding? = null
        override fun encrypt(plaintext: String) = "umhuellt:" + plaintext.reversed()
        override fun decrypt(saved: String) = saved.removePrefix("umhuellt:").reversed()
        override fun open(saved: String): VaultFinding = situation ?: VaultFinding.Readable(decrypt(saved))
    }

    private val vault = Vault()
    private val file = File(folder, "ablage.schluessel")

    /** What the key store wrote — its output, read like any other result. */
    private fun onDisk() = String(file.readBytes(), Charsets.UTF_8)

    @Test
    fun `the key is created once and lies only wrapped`() {
        val first = StoreKey(file, vault)
        val k = first.fetch()
        assertEquals(32, k.size)
        assertTrue(first.newCreated)
        assertTrue("On disk only wrapped", onDisk().startsWith("umhuellt:"))
        val second = StoreKey(file, vault)
        assertArrayEquals("The same after the restart", k, second.fetch())
        assertFalse(second.newCreated)
        assertNotEquals("One of its own per purpose", second.forTarget("bestand.db").toList(), second.forTarget("antworten").toList())
    }

    @Test
    fun `after renewal everything old is unreadable, even after a restart`() {
        val k = StoreKey(file, vault)
        var closed = 0
        k.beforeRenewal { closed++ }
        val old = k.fetch().copyOf()
        val secret = StoreCipher { k.forTarget("antworten") }.encrypt("Kaufpreis 499.99".toByteArray(), "a")
        k.renew()
        assertEquals("Whoever holds the key closes first", 1, closed)
        assertNotEquals(old.toList(), k.fetch().toList())
        assertTrue("The new key is reported as new", k.newCreated)
        assertNull(StoreCipher { k.forTarget("antworten") }.decrypt(secret, "a"))
        assertNull("The disk also has only the new one",
            StoreCipher { StoreKey(file, vault).forTarget("antworten") }.decrypt(secret, "a"))
    }

    @Test
    fun `a locked keystore does not replace the key`() {
        StoreKey(file, vault).fetch()
        val before = onDisk()
        vault.situation = VaultFinding.LockedState
        try {
            StoreKey(file, vault).fetch()
            fail("Locked must fail, not silently create a new key")
        } catch (_: IOException) {
        }
        assertEquals(before, onDisk())
        vault.situation = VaultFinding.Gone
        val newValue = StoreKey(file, vault)
        newValue.fetch()
        assertTrue("Gone means: create anew and say so", newValue.newCreated)
        assertNotEquals(before, onDisk())
    }

    @Test
    fun `plaintext and foreign data do not count`() {
        val k = StoreKey(file, vault)
        val cipher = StoreCipher { k.forTarget("antworten") }
        val secret = cipher.encrypt("Kaufpreis 499.99".toByteArray(), "antworten/a/sets.json")
        assertEquals("Kaufpreis 499.99", cipher.decrypt(secret, "antworten/a/sets.json")!!.toString(Charsets.UTF_8))
        assertNull("Plaintext old stock", cipher.decrypt("""{"preis":499.99}""".toByteArray(), "antworten/a/sets.json"))
        assertNull("Different key", StoreCipher { k.forTarget("widget") }.decrypt(secret, "antworten/a/sets.json"))
        secret[secret.size - 1] = (secret[secret.size - 1] + 1).toByte()
        assertNull("Changed", cipher.decrypt(secret, "antworten/a/sets.json"))
    }

    @Test
    fun `a file under a foreign name does not count`() {
        val k = StoreKey(file, vault)
        val cipher = StoreCipher { k.forTarget("antworten") }
        val secret = cipher.encrypt("Kaufpreis 499.99".toByteArray(), "antworten/a/sets.json")
        assertNull("Different file name", cipher.decrypt(secret, "antworten/a/finanzen.json"))
        assertNull("Different compartment", cipher.decrypt(secret, "antworten/b/sets.json"))
    }
}
