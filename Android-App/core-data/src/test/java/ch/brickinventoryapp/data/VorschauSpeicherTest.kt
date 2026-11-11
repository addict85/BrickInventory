package ch.brickinventoryapp.data

import ch.brickinventoryapp.data.cache.VorschauSpeicher
import ch.brickinventoryapp.sicherheit.AblageChiffre
import org.junit.After
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File
import java.io.RandomAccessFile

/**
 * Die Vorschau-Ablage gegen ein echtes Verzeichnis: Sie nimmt nur Vorschaubilder,
 * hält ihre Obergrenze selbst ein (unter filesDir räumt sonst niemand) und wirft beim
 * Aufräumen Vorgewärmtes vor wirklich Angesehenem weg. Grosse Belegung entsteht als
 * Datei mit Loch (setLength), damit der Test keine 150 MB schreibt.
 *
 * Gegenproben (Patches unter gegenproben/):
 *   vorschau-nimmt-alles          istVorschau() immer true → rot „nur Vorschaubilder …“
 *   vorschau-ohne-obergrenze      schreibe() ruft aufraeumenFallsNoetig() nicht → rot
 *                                 „über der Obergrenze fliegt das Älteste …“
 *   vorschau-spekulativ-frisch    setLastModified für Vorgewärmtes entfernt → rot
 *                                 „ein vorgewärmtes Bild fliegt vor einem angesehenen“
 */
class VorschauSpeicherTest {

    private val wurzel = File(System.getProperty("java.io.tmpdir"), "bim-vorschau-grenze-${System.nanoTime()}")
    private val speicher = VorschauSpeicher({ wurzel }, AblageChiffre { ByteArray(32) { 5 } }) { ByteArray(32) { 15 } }
    private val basis = "https://brick.example/api/v1/images"

    @After
    fun zu() { wurzel.deleteRecursively() }

    /** Der Ordner, in dem die Ablage ihre Dateien hält; nach dem ersten Schreiben bekannt. */
    private fun ordner(): File = wurzel.walkTopDown().first { it.isFile && !it.name.endsWith(".tmp") }.parentFile!!

    /** Eine Datei mit Loch: belegt [bytes] laut Länge, ohne sie zu schreiben. */
    private fun belege(name: String, bytes: Long, zeit: Long): File =
        File(ordner(), name).also { f ->
            RandomAccessFile(f, "rw").use { it.setLength(bytes) }
            f.setLastModified(zeit)
        }

    @Test
    fun `nur Vorschaubilder gehoeren in die Ablage`() {
        assertTrue(speicher.istVorschau("$basis/set/75192-1?thumb=1"))
        assertTrue(speicher.istVorschau("$basis/set/75192-1?x=2&thumb=1"))
        assertTrue("Die vom Server _thumb benannte Datei", speicher.istVorschau("https://brick.example/uploads/75192-1_thumb.jpg"))
        assertFalse("Die volle Auflösung gehört nicht hierher", speicher.istVorschau("$basis/set/75192-1"))
        assertFalse(speicher.istVorschau("https://brick.example/uploads/75192-1.jpg"))
    }

    @Test
    fun `ueber der Obergrenze fliegt das Aelteste, bis vier Fuenftel frei sind`() {
        val jetzt = System.currentTimeMillis()
        speicher.schreibe("$basis/set/1-1?thumb=1", "erstes".toByteArray())
        val alt = belege("alt", 60L * 1024 * 1024, jetzt - 3_600_000)
        val mittel = belege("mittel", 50L * 1024 * 1024, jetzt - 1_800_000)
        val neu = belege("neu", 40L * 1024 * 1024, jetzt - 60_000)
        val bild = "JPEG-10179-1".toByteArray()

        speicher.schreibe("$basis/set/10179-1?thumb=1", bild)

        assertFalse("Das älteste Bild bleibt über der Obergrenze liegen", alt.exists())
        assertTrue("Aufgeräumt wird nur bis vier Fünftel, nicht alles", mittel.exists() && neu.exists())
        assertArrayEquals(bild, speicher.lies("$basis/set/10179-1?thumb=1"))
        assertTrue("Belegt ${speicher.belegt()}", speicher.belegt() <= VorschauSpeicher.MAX_BYTES)
    }

    @Test
    fun `ein vorgewaermtes Bild fliegt vor einem angesehenen`() {
        val angesehen = "$basis/set/75192-1?thumb=1"
        val vorgewaermt = "$basis/set/10294-1?thumb=1"
        speicher.schreibe(angesehen, "angesehen".toByteArray())
        // Älter als das angesehene, aber jünger als jeder vorgewärmte Stempel.
        belege("gross", VorschauSpeicher.MAX_BYTES - 64, System.currentTimeMillis() - 3_600_000)

        speicher.schreibe(vorgewaermt, "vorgewaermt".toByteArray(), spekulativ = true)

        assertFalse("Das vorgewärmte Bild verdrängt beim Aufräumen das angesehene", speicher.hat(vorgewaermt))
        assertTrue("Das angesehene Bild ist weg", speicher.hat(angesehen))
    }
}
