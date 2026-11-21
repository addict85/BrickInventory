package ch.brickinventoryapp.data

import ch.brickinventoryapp.data.cache.VorschauSpeicher
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
 *   A  schreibe() stores the bytes unencrypted again and lies() returns them raw
 *      → red “a thumbnail does not lie in plaintext …”;
 *      gegenproben/vorschau-klartext.patch
 *   B  in the folder setup the deleting of the plaintext files removed → red “plaintext
 *      of older versions disappears …”
 *   C  schluessel() again as SHA-256 of the address → red “the file name does not reveal the address
 *      …”; gegenproben/vorschau-namen-ungestreut.patch
 */
class PreviewEncryptedTest {

    private val root = File(System.getProperty("java.io.tmpdir"), "bim-vorschau-${System.nanoTime()}")
    private val adresse = "https://brick.example/api/v1/images/set/75192-1?thumb=1"
    private val bild = "JPEG-75192-Millennium-Falcon".toByteArray()

    private fun speicher() = VorschauSpeicher({ root }, StoreCipher { ByteArray(32) { 3 } }) { ByteArray(32) { 13 } }

    @After
    fun zu() { root.deleteRecursively() }

    private fun plaintextSomewhere(): Boolean = root.walkTopDown().filter { it.isFile }
        .any { String(it.readBytes(), Charsets.ISO_8859_1).contains("75192-Millennium") }

    @Test
    fun `a thumbnail does not lie in plaintext and comes back unchanged`() {
        val s = speicher()
        s.schreibe(adresse, bild)
        assertTrue(s.hat(adresse))
        assertFalse("Das Bild liegt im Klartext auf der Platte", plaintextSomewhere())
        assertArrayEquals(bild, s.lies(adresse))
        assertArrayEquals("Ein neuer Prozess liest es ebenso", bild, speicher().lies(adresse))
    }

    @Test
    fun `plaintext of older versions disappears on first access`() {
        val alt = File(root, "a".repeat(64)).apply { parentFile!!.mkdirs(); writeBytes(bild) }
        val s = speicher()
        assertNull(s.lies(adresse))
        assertFalse("Das Klartext-Bild der Vorfassung bleibt liegen", alt.exists())
        assertFalse(plaintextSomewhere())
    }

    @Test
    fun `the file name does not reveal the address, and the store with SHA-256 names disappears`() {
        val alt = File(root, "v2/" + "b".repeat(64)).apply { parentFile!!.mkdirs(); writeBytes(byteArrayOf(1)) }
        speicher().schreibe(adresse, bild)
        assertFalse("Die v2-Ablage bleibt liegen", alt.exists())
        val sha = MessageDigest.getInstance("SHA-256").digest(adresse.toByteArray()).joinToString("") { "%02x".format(it) }
        val name = root.walkTopDown().single { it.isFile }.name
        assertFalse("Der Name ist der SHA-256 der Adresse", name == sha)
        val anders = File(root.parentFile, root.name + "-b")
        try {
            VorschauSpeicher({ anders }, StoreCipher { ByteArray(32) { 3 } }) { ByteArray(32) { 14 } }.schreibe(adresse, bild)
            assertFalse("Der Name hängt nicht am Schlüssel", anders.walkTopDown().single { it.isFile }.name == name)
        } finally {
            anders.deleteRecursively()
        }
    }

    @Test
    fun `a file under a foreign name does not count and is discarded`() {
        val s = speicher()
        s.schreibe(adresse, bild)
        val andere = "https://brick.example/api/v1/images/set/10179-1?thumb=1"
        val echt = root.walkTopDown().single { it.isFile }
        s.schreibe(andere, "x".toByteArray())
        val ziel = root.walkTopDown().single { it.isFile && it != echt }
        echt.copyTo(ziel, overwrite = true)
        assertNull("Das Bild eines anderen Sets gilt nicht als dieses", s.lies(andere))
        assertFalse("Die unlesbare Datei bleibt liegen und gilt beim Vorwärmen als da", s.hat(andere))
    }
}
