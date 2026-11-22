package ch.brickinventoryapp.security

import ch.brickinventoryapp.model.util.LockWipe
import org.junit.After
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.fail
import org.junit.Test
import java.io.File
import java.io.IOException
import java.util.Base64

/**
 * When the device locks, the store key leaves memory: a locked phone then only yields what
 * the Keystore releases, and that is nothing until unlocking. A key handed out earlier stays
 * usable (it is a copy), and one failing holder does not keep the others' secrets.
 *
 * Counter-checks (local JUnit):
 *   A  forgetInMemory() empty → red „after the wipe a locked device yields no key“
 *   B  fetch() returns the cached array instead of a copy → red „a key handed out before …“
 *      and „after the wipe …“ (the handed-out array was zeroed along)
 *   C  LockWipe.wipe() without catchUnlessCancelled → red „one failing holder …“
 */
class LockWipeTest {

    private val folder = File(System.getProperty("java.io.tmpdir"), "bim-sperre-${System.nanoTime()}").apply { mkdirs() }

    @After
    fun tearDown() {
        folder.deleteRecursively()
    }

    /** Like a Keystore key with setUnlockedDeviceRequired: locked it opens nothing. */
    private class LockedVault : TokenEncryption {
        var locked = false
        override fun encrypt(plaintext: String): String {
            check(!locked) { "locked" }
            return "t:" + Base64.getEncoder().encodeToString(plaintext.toByteArray())
        }
        override fun decrypt(saved: String): String? = (open(saved) as? VaultFinding.Readable)?.plaintext
        override fun open(saved: String): VaultFinding =
            if (locked) VaultFinding.LockedState
            else VaultFinding.Readable(String(Base64.getDecoder().decode(saved.removePrefix("t:"))))
    }

    private val vault = LockedVault()
    private val key = StoreKey(File(folder, "ablage.schluessel"), vault)

    @Test
    fun `after the wipe a locked device yields no key, unlocked the same one again`() {
        val before = key.fetch()
        vault.locked = true
        assertArrayEquals("without discarding it stays in memory", before, key.fetch())
        key.forgetInMemory()
        try {
            key.fetch()
            fail("locked and discarded, no key may come out any more")
        } catch (_: IOException) {
            // expected: the Keystore releases nothing while locked
        }
        vault.locked = false
        assertArrayEquals("the same key from disk, not a new one", before, key.fetch())
    }

    @Test
    fun `a key handed out before the wipe stays intact`() {
        val handedOut = key.fetch()
        val copy = handedOut.copyOf()
        key.forgetInMemory()
        assertArrayEquals("a running encryption would otherwise get zeros", copy, handedOut)
    }

    @Test
    fun `one failing holder does not keep the others in memory`() {
        val wipe = LockWipe()
        val calls = mutableListOf<String>()
        wipe.register({ calls += "a"; error("broken") }, { calls += "ra" })
        wipe.register({ calls += "b" }, { calls += "rb" })
        wipe.wipe()
        wipe.restore()
        assertEquals(listOf("a", "b", "ra", "rb"), calls)
    }
}
