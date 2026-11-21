package ch.brickinventoryapp.data

import ch.brickinventoryapp.data.cache.VorschauSpeicher
import ch.brickinventoryapp.security.StoreCipher
import org.junit.After
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File
import java.io.RandomAccessFile

/**
 * The preview store against a real directory: it takes only thumbnails,
 * keeps its upper limit itself (under filesDir nobody else cleans up) and, when
 * cleaning up, throws away prewarmed before really viewed images. Large usage arises as a
 * sparse file (setLength), so that the test does not write 150 MB.
 *
 * Counter-checks (patches under gegenproben/):
 *   vorschau-nimmt-alles          isPreview() always true → red “only thumbnails …”
 *   vorschau-ohne-obergrenze      schreibe() does not call cleanupIfNeeded() → red
 *                                 “above the upper limit the oldest goes …”
 *   vorschau-spekulativ-frisch    setLastModified for prewarmed images removed → red
 *                                 “a warmed image goes before a viewed one”
 */
class PreviewStorageTest {

    private val root = File(System.getProperty("java.io.tmpdir"), "bim-vorschau-grenze-${System.nanoTime()}")
    private val speicher = VorschauSpeicher({ root }, StoreCipher { ByteArray(32) { 5 } }) { ByteArray(32) { 15 } }
    private val basis = "https://brick.example/api/v1/images"

    @After
    fun zu() { root.deleteRecursively() }

    /** The folder in which the store keeps its files; known after the first write. */
    private fun folder(): File = root.walkTopDown().first { it.isFile && !it.name.endsWith(".tmp") }.parentFile!!

    /** A sparse file: occupies [bytes] by length without writing them. */
    private fun receipts(name: String, bytes: Long, zeit: Long): File =
        File(folder(), name).also { f ->
            RandomAccessFile(f, "rw").use { it.setLength(bytes) }
            f.setLastModified(zeit)
        }

    @Test
    fun `only thumbnails belong in the store`() {
        assertTrue(speicher.isPreview("$basis/set/75192-1?thumb=1"))
        assertTrue(speicher.isPreview("$basis/set/75192-1?x=2&thumb=1"))
        assertTrue("Die vom Server _thumb benannte Datei", speicher.isPreview("https://brick.example/uploads/75192-1_thumb.jpg"))
        assertFalse("Die volle Auflösung gehört nicht hierher", speicher.isPreview("$basis/set/75192-1"))
        assertFalse(speicher.isPreview("https://brick.example/uploads/75192-1.jpg"))
    }

    @Test
    fun `above the upper limit the oldest goes until four fifths are free`() {
        val jetzt = System.currentTimeMillis()
        speicher.schreibe("$basis/set/1-1?thumb=1", "erstes".toByteArray())
        val alt = receipts("alt", 60L * 1024 * 1024, jetzt - 3_600_000)
        val mittel = receipts("mittel", 50L * 1024 * 1024, jetzt - 1_800_000)
        val neu = receipts("neu", 40L * 1024 * 1024, jetzt - 60_000)
        val bild = "JPEG-10179-1".toByteArray()

        speicher.schreibe("$basis/set/10179-1?thumb=1", bild)

        assertFalse("Das älteste Bild bleibt über der Obergrenze liegen", alt.exists())
        assertTrue("Aufgeräumt wird nur bis vier Fünftel, nicht alles", mittel.exists() && neu.exists())
        assertArrayEquals(bild, speicher.lies("$basis/set/10179-1?thumb=1"))
        assertTrue("Belegt ${speicher.belegt()}", speicher.belegt() <= VorschauSpeicher.MAX_BYTES)
    }

    @Test
    fun `a warmed image goes before a viewed one`() {
        val angesehen = "$basis/set/75192-1?thumb=1"
        val vorgewaermt = "$basis/set/10294-1?thumb=1"
        speicher.schreibe(angesehen, "angesehen".toByteArray())
        // Older than the viewed one, but younger than every prewarmed stamp.
        receipts("gross", VorschauSpeicher.MAX_BYTES - 64, System.currentTimeMillis() - 3_600_000)

        speicher.schreibe(vorgewaermt, "vorgewaermt".toByteArray(), speculative = true)

        assertFalse("Das vorgewärmte Bild verdrängt beim Aufräumen das angesehene", speicher.hat(vorgewaermt))
        assertTrue("Das angesehene Bild ist weg", speicher.hat(angesehen))
    }
}
