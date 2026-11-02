package ch.brickinventoryapp

import ch.brickinventoryapp.util.teilelistenAblage
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Test
import java.io.File

/**
 * Die exportierte Teileliste trägt das Inventar und liegt darum nur im
 * app-eigenen filesDir; eine Kopie älterer Fassungen im externen Bereich
 * verschwindet beim nächsten Export.
 *
 * Gegenprobe (01.11.2026, gemessen mit kotlinc lokal): in teilelistenAblage()
 * wieder `extern ?: intern` als Wurzel → rot „die Teileliste liegt intern …“.
 */
class TeilelistenAblageTest {

    private val wurzel = File(System.getProperty("java.io.tmpdir"), "bim-teile-${System.nanoTime()}")
    private val intern = File(wurzel, "files")
    private val extern = File(wurzel, "extern")

    @After
    fun zu() { wurzel.deleteRecursively() }

    @Test
    fun `die Teileliste liegt intern, eine alte externe Kopie verschwindet`() {
        val alt = File(extern, "pdf/teileliste.pdf").apply { parentFile.mkdirs(); writeText("Inventar") }
        val ziel = teilelistenAblage(intern, extern)
        assertEquals(File(intern, "pdf/teileliste.pdf"), ziel)
        assertEquals("pdf/ für den FileProvider angelegt", true, ziel.parentFile.isDirectory)
        assertFalse("Die alte Kopie im externen Bereich bleibt liegen", alt.exists())
    }

    @Test
    fun `ohne externen Speicher dasselbe Ziel`() {
        assertEquals(File(intern, "pdf/teileliste.pdf"), teilelistenAblage(intern, null))
    }
}
