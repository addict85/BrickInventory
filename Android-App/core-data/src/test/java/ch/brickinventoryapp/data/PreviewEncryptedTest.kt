package ch.brickinventoryapp.data

import ch.brickinventoryapp.data.cache.PreviewMemory
import ch.brickinventoryapp.security.StoreCipher
import org.junit.After
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File
import java.security.MessageDigest

/**
 * The preview store lies encrypted: the images of one's own
 * collection show which sets someone owns. Plaintext of older versions is
 * discarded, a file under a foreign name does not count. Executed against a
 * real directory.
 *
 * Counter-checks:
 *   A  write() stores the bytes unencrypted again and read() returns them raw
 *      → red “a thumbnail does not lie in plaintext …”;
 *      counter-checks/vorschau-klartext.patch
 *   B  in the folder setup the deleting of the plaintext files removed → red “plaintext
 *      of older versions disappears …”
 *   C  key() again as SHA-256 of the address → red “the file name does not reveal the address
 *      …”; counter-checks/vorschau-namen-ungestreut.patch
 */
class PreviewEncryptedTest {

    private val root = File(System.getProperty("java.io.tmpdir"), "bim-vorschau-${System.nanoTime()}")
    private val address = "https://brick.example/api/v1/images/set/75192-1?thumb=1"
    private val image = "JPEG-75192-Millennium-Falcon".toByteArray()

    private fun memory() = PreviewMemory({ root }, StoreCipher { ByteArray(32) { 3 } }) { ByteArray(32) { 13 } }

    @After
    fun tearDown() { root.deleteRecursively() }

    private fun plaintextSomewhere(): Boolean = root.walkTopDown().filter { it.isFile }
        .any { String(it.readBytes(), Charsets.ISO_8859_1).contains("75192-Millennium") }

    @Test
    fun `a thumbnail does not lie in plaintext and comes back unchanged`() {
        val s = memory()
        s.write(address, image)
        assertTrue(s.has(address))
        assertFalse("Das Bild liegt im Klartext auf der Platte", plaintextSomewhere())
        assertArrayEquals(image, s.read(address))
        assertArrayEquals("Ein neuer Prozess liest es ebenso", image, memory().read(address))
    }

    @Test
    fun `plaintext of older versions disappears on first access`() {
        val old = File(root, "a".repeat(64)).apply { parentFile!!.mkdirs(); writeBytes(image) }
        val s = memory()
        assertNull(s.read(address))
        assertFalse("Das Klartext-Bild der Vorfassung bleibt liegen", old.exists())
        assertFalse(plaintextSomewhere())
    }

    @Test
    fun `the file name does not reveal the address, and the store with SHA-256 names disappears`() {
        val old = File(root, "v2/" + "b".repeat(64)).apply { parentFile!!.mkdirs(); writeBytes(byteArrayOf(1)) }
        memory().write(address, image)
        assertFalse("Die v2-Ablage bleibt liegen", old.exists())
        val sha = MessageDigest.getInstance("SHA-256").digest(address.toByteArray()).joinToString("") { "%02x".format(it) }
        val name = root.walkTopDown().single { it.isFile }.name
        assertFalse("Der Name ist der SHA-256 der Adresse", name == sha)
        val different = File(root.parentFile, root.name + "-b")
        try {
            PreviewMemory({ different }, StoreCipher { ByteArray(32) { 3 } }) { ByteArray(32) { 14 } }.write(address, image)
            assertFalse("Der Name hängt nicht am Schlüssel", different.walkTopDown().single { it.isFile }.name == name)
        } finally {
            different.deleteRecursively()
        }
    }

    @Test
    fun `a file under a foreign name does not count and is discarded`() {
        val s = memory()
        s.write(address, image)
        val other = "https://brick.example/api/v1/images/set/10179-1?thumb=1"
        val real = root.walkTopDown().single { it.isFile }
        s.write(other, "x".toByteArray())
        val target = root.walkTopDown().single { it.isFile && it != real }
        real.copyTo(target, overwrite = true)
        assertNull("Das Bild eines anderen Sets gilt nicht als dieses", s.read(other))
        assertFalse("Die unlesbare Datei bleibt liegen und gilt beim Vorwärmen als da", s.has(other))
    }
}
