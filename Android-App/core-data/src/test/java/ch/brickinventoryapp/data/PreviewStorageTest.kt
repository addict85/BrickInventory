package ch.brickinventoryapp.data

import ch.brickinventoryapp.data.cache.PreviewMemory
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
 * Counter-checks (patches under counter-checks/):
 *   preview-takes-everything          isPreview() always true → red “only thumbnails …”
 *   preview-without-upper-limit      write() does not call cleanupIfNeeded() → red
 *                                 “above the upper limit the oldest goes …”
 *   preview-speculative-fresh    setLastModified for prewarmed images removed → red
 *                                 “a warmed image goes before a viewed one”
 */
class PreviewStorageTest {

    private val root = File(System.getProperty("java.io.tmpdir"), "bim-vorschau-grenze-${System.nanoTime()}")
    private val memory = PreviewMemory({ root }, StoreCipher { ByteArray(32) { 5 } }) { ByteArray(32) { 15 } }
    private val basis = "https://brick.example/api/v2/images"

    @After
    fun tearDown() { root.deleteRecursively() }

    /** The folder in which the store keeps its files; known after the first write. */
    private fun folder(): File = root.walkTopDown().first { it.isFile && !it.name.endsWith(".tmp") }.parentFile!!

    /** A sparse file: occupies [bytes] by length without writing them. */
    private fun receipts(name: String, bytes: Long, time: Long): File =
        File(folder(), name).also { f ->
            RandomAccessFile(f, "rw").use { it.setLength(bytes) }
            f.setLastModified(time)
        }

    @Test
    fun `only thumbnails belong in the store`() {
        assertTrue(memory.isPreview("$basis/set/75192-1?thumb=1"))
        assertTrue(memory.isPreview("$basis/set/75192-1?x=2&thumb=1"))
        assertTrue("The file named _thumb by the server", memory.isPreview("https://brick.example/uploads/75192-1_thumb.jpg"))
        assertFalse("The full resolution does not belong here", memory.isPreview("$basis/set/75192-1"))
        assertFalse(memory.isPreview("https://brick.example/uploads/75192-1.jpg"))
    }

    @Test
    fun `above the upper limit the oldest goes until four fifths are free`() {
        val now = System.currentTimeMillis()
        memory.write("$basis/set/1-1?thumb=1", "erstes".toByteArray())
        val old = receipts("alt", 60L * 1024 * 1024, now - 3_600_000)
        val medium = receipts("mittel", 50L * 1024 * 1024, now - 1_800_000)
        val newValue = receipts("neu", 40L * 1024 * 1024, now - 60_000)
        val image = "JPEG-10179-1".toByteArray()

        memory.write("$basis/set/10179-1?thumb=1", image)

        assertFalse("The oldest image stays above the upper limit", old.exists())
        assertTrue("Cleanup only goes down to four fifths, not everything", medium.exists() && newValue.exists())
        assertArrayEquals(image, memory.read("$basis/set/10179-1?thumb=1"))
        assertTrue("Occupied ${memory.occupied()}", memory.occupied() <= PreviewMemory.MAX_BYTES)
    }

    @Test
    fun `a warmed image goes before a viewed one`() {
        val viewed = "$basis/set/75192-1?thumb=1"
        val prewarmed = "$basis/set/10294-1?thumb=1"
        memory.write(viewed, "angesehen".toByteArray())
        // Older than the viewed one, but younger than every prewarmed stamp.
        receipts("gross", PreviewMemory.MAX_BYTES - 64, System.currentTimeMillis() - 3_600_000)

        memory.write(prewarmed, "vorgewaermt".toByteArray(), speculative = true)

        assertFalse("On cleanup the prewarmed image displaces the viewed one", memory.has(prewarmed))
        assertTrue("The viewed image is gone", memory.has(viewed))
    }
}
