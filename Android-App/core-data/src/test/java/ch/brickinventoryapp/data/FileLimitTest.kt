package ch.brickinventoryapp.data

import ch.brickinventoryapp.model.file.FileReader
import ch.brickinventoryapp.model.file.FileRef
import ch.brickinventoryapp.model.file.Gelesen
import ch.brickinventoryapp.data.file.readLimited
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
        var gelesen = 0L
        override fun read(): Int {
            gelesen++
            if (gelesen > atMost) throw AssertionError("über die Grenze hinaus gelesen: $gelesen Bytes")
            return 7
        }
    }

    @Test
    fun `up to the limit the whole content comes, one byte more does not`() {
        val genau = ByteArray(1000) { it.toByte() }
        assertArrayEquals(genau, readLimited(ByteArrayInputStream(genau), 1000))
        assertNull(readLimited(ByteArrayInputStream(ByteArray(1001)), 1000))
        assertArrayEquals(ByteArray(0), readLimited(ByteArrayInputStream(ByteArray(0)), 0))
    }

    @Test
    fun `an endless stream is not read beyond the limit`() {
        val grenze = 200_000L
        val strom = Endless(grenze + 64 * 1024)
        assertNull(readLimited(strom, grenze))
        assertEquals("Gelesen wird die Grenze und ein Byte zur Probe", grenze + 1, strom.gelesen)
    }

    @Test
    fun `a reader without its own limit reports a too large file as too large`() {
        val reader = object : FileReader {
            override suspend fun lies(datei: FileRef): Pair<String?, ByteArray>? = "text/csv" to ByteArray(11)
        }
        assertEquals(Gelesen.ToLarge, runBlocking { reader.readAtMost(FileRef("content://x"), 10) })
        val inhalt = runBlocking { reader.readAtMost(FileRef("content://x"), 11) }
        assertTrue(inhalt is Gelesen.Inhalt && inhalt.typ == "text/csv" && inhalt.bytes.size == 11)
    }
}
