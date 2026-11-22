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
 *   C  LockWipe.wipe() without fangeAusserAbbruch → red „one failing holder …“
 */
class LockWipeTest {

    private val folder = File(System.getProperty("java.io.tmpdir"), "bim-sperre-${System.nanoTime()}").apply { mkdirs() }

    @After
    fun zu() {
        folder.deleteRecursively()
    }

    /** Like a Keystore key with setUnlockedDeviceRequired: locked it opens nothing. */
    private class LockedVault : TokenEncryption {
        var locked = false
        override fun verschluessle(klartext: String): String {
            check(!locked) { "gesperrt" }
            return "t:" + Base64.getEncoder().encodeToString(klartext.toByteArray())
        }
        override fun entschluessle(gespeichert: String): String? = (oeffne(gespeichert) as? Tresorbefund.Readable)?.klartext
        override fun oeffne(gespeichert: String): Tresorbefund =
            if (locked) Tresorbefund.Gesperrt
            else Tresorbefund.Readable(String(Base64.getDecoder().decode(gespeichert.removePrefix("t:"))))
    }

    private val vault = LockedVault()
    private val key = Ablageschluessel(File(folder, "ablage.schluessel"), vault)

    @Test
    fun `after the wipe a locked device yields no key, unlocked the same one again`() {
        val before = key.fetch()
        vault.locked = true
        assertArrayEquals("Ohne Verwerfen bleibt er im Speicher", before, key.fetch())
        key.forgetInMemory()
        try {
            key.fetch()
            fail("Gesperrt und verworfen darf kein Schlüssel mehr herauskommen")
        } catch (_: IOException) {
            // expected: the Keystore releases nothing while locked
        }
        vault.locked = false
        assertArrayEquals("Derselbe Schlüssel von der Platte, kein neuer", before, key.fetch())
    }

    @Test
    fun `a key handed out before the wipe stays intact`() {
        val handedOut = key.fetch()
        val copy = handedOut.copyOf()
        key.forgetInMemory()
        assertArrayEquals("Eine laufende Verschlüsselung bekäme sonst Nullen", copy, handedOut)
    }

    @Test
    fun `one failing holder does not keep the others in memory`() {
        val wipe = LockWipe()
        val calls = mutableListOf<String>()
        wipe.register({ calls += "a"; error("kaputt") }, { calls += "ra" })
        wipe.register({ calls += "b" }, { calls += "rb" })
        wipe.wipe()
        wipe.restore()
        assertEquals(listOf("a", "b", "ra", "rb"), calls)
    }
}
