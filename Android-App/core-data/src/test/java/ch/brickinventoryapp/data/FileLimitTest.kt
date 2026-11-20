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
 * Eine gewählte Datei kommt nur bis zur Grenze in den Speicher: Ein Anbieter, der
 * endlos liefert oder eine falsche Grösse nennt, bringt die App nicht zum Absturz.
 *
 * Gegenprobe (lokal mit kotlinc gemessen):
 *   datei-ganz-gelesen  readLimited() liest mit readBytes() alles und prüft danach →
 *                       rot „ein endloser Strom wird nach der Grenze nicht weiter gelesen“
 */
class FileLimitTest {

    /** Liefert ohne Ende; zählt, und wirft, sobald weit über die Grenze gelesen wird. */
    private class Endless(private val atMost: Long) : InputStream() {
        var gelesen = 0L
        override fun read(): Int {
            gelesen++
            if (gelesen > atMost) throw AssertionError("über die Grenze hinaus gelesen: $gelesen Bytes")
            return 7
        }
    }

    @Test
    fun `bis zur Grenze kommt der ganze Inhalt, ein Byte mehr nicht`() {
        val genau = ByteArray(1000) { it.toByte() }
        assertArrayEquals(genau, readLimited(ByteArrayInputStream(genau), 1000))
        assertNull(readLimited(ByteArrayInputStream(ByteArray(1001)), 1000))
        assertArrayEquals(ByteArray(0), readLimited(ByteArrayInputStream(ByteArray(0)), 0))
    }

    @Test
    fun `ein endloser Strom wird nach der Grenze nicht weiter gelesen`() {
        val grenze = 200_000L
        val strom = Endless(grenze + 64 * 1024)
        assertNull(readLimited(strom, grenze))
        assertEquals("Gelesen wird die Grenze und ein Byte zur Probe", grenze + 1, strom.gelesen)
    }

    @Test
    fun `ein Leser ohne eigene Grenze meldet eine zu grosse Datei als zu gross`() {
        val reader = object : FileReader {
            override suspend fun lies(datei: FileRef): Pair<String?, ByteArray>? = "text/csv" to ByteArray(11)
        }
        assertEquals(Gelesen.ToLarge, runBlocking { reader.readAtMost(FileRef("content://x"), 10) })
        val inhalt = runBlocking { reader.readAtMost(FileRef("content://x"), 11) }
        assertTrue(inhalt is Gelesen.Inhalt && inhalt.typ == "text/csv" && inhalt.bytes.size == 11)
    }
}
