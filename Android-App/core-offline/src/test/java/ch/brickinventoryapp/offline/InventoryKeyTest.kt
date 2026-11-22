package ch.brickinventoryapp.offline

import ch.brickinventoryapp.offline.room.isPlaintextDatabase
import ch.brickinventoryapp.offline.room.sqlcipherPassword
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

/**
 * The stock lies encrypted with SQLCipher: the password is the ready
 * key as hex literal (no second derivation in SQLCipher), and a
 * plaintext legacy stock is recognized by its file header.
 *
 * Counter-check (measured locally on the cut-out StockEncryption.kt):
 * counter-checks/bestand-kopf-ungeprueft.patch,
 * isPlaintextDatabase() without comparison with the header → red “the database gets a
 * ready key …” (the encrypted file would count as plaintext).
 */
class InventoryKeyTest {

    private val folder = File(System.getProperty("java.io.tmpdir"), "bim-bestand-${System.nanoTime()}").apply { mkdirs() }

    @After
    fun tearDown() {
        folder.deleteRecursively()
    }

    @Test
    fun `the database gets a ready key and recognizes plaintext`() {
        val key = ByteArray(32) { it.toByte() }
        val p = String(sqlcipherPassword(key), Charsets.US_ASCII)
        assertEquals("x'000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f'", p)
        val clear = File(folder, "bestand.db").apply { writeBytes("SQLite format 3\u0000".toByteArray() + ByteArray(100)) }
        assertTrue(isPlaintextDatabase(clear))
        val encrypted = File(folder, "neu.db").apply { writeBytes(ByteArray(116) { (it * 7).toByte() }) }
        assertFalse(isPlaintextDatabase(encrypted))
        assertFalse(isPlaintextDatabase(File(folder, "fehlt.db")))
    }
}
