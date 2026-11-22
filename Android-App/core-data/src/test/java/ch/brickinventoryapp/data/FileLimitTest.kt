package ch.brickinventoryapp.data

import ch.brickinventoryapp.data.file.readLimited
import ch.brickinventoryapp.model.file.FileReader
import ch.brickinventoryapp.model.file.FileRef
import ch.brickinventoryapp.model.file.Read
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.ByteArrayInputStream
import java.io.InputStream

/**
 * A chosen file comes into memory only up to the limit: a provider that
 * delivers endlessly or names a wrong size does not crash the app.
 *
 * Counter-check (measured locally with kotlinc):
 *   datei-ganz-gelesen  readLimited() reads everything with readBytes() and checks afterwards →
 *                       red “an endless stream is not read beyond the limit“
 */
class FileLimitTest {

    /** Delivers without end; counts, and throws as soon as reading goes far beyond the limit. */
    private class Endless(private val atMost: Long) : InputStream() {
        var read = 0L
        override fun read(): Int {
            read++
            if (read > atMost) throw AssertionError("über die Grenze hinaus gelesen: $read Bytes")
            return 7
        }
    }

    @Test
    fun `up to the limit the whole content comes, one byte more does not`() {
        val exact = ByteArray(1000) { it.toByte() }
        assertArrayEquals(exact, readLimited(ByteArrayInputStream(exact), 1000))
        assertNull(readLimited(ByteArrayInputStream(ByteArray(1001)), 1000))
        assertArrayEquals(ByteArray(0), readLimited(ByteArrayInputStream(ByteArray(0)), 0))
    }

    @Test
    fun `an endless stream is not read beyond the limit`() {
        val limit = 200_000L
        val stream = Endless(limit + 64 * 1024)
        assertNull(readLimited(stream, limit))
        assertEquals("Gelesen wird die Grenze und ein Byte zur Probe", limit + 1, stream.read)
    }

    @Test
    fun `a reader without its own limit reports a too large file as too large`() {
        val reader = object : FileReader {
            override suspend fun read(file: FileRef): Pair<String?, ByteArray>? = "text/csv" to ByteArray(11)
        }
        assertEquals(Read.ToLarge, runBlocking { reader.readAtMost(FileRef("content://x"), 10) })
        val content = runBlocking { reader.readAtMost(FileRef("content://x"), 11) }
        assertTrue(content is Read.Content && content.type == "text/csv" && content.bytes.size == 11)
    }
}
