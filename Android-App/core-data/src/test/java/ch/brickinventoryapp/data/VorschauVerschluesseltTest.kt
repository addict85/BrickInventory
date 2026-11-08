package ch.brickinventoryapp.data

import ch.brickinventoryapp.data.cache.VorschauSpeicher
import ch.brickinventoryapp.data.util.AblageChiffre
import org.junit.After
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

/**
 * Die Vorschau-Ablage liegt verschlüsselt: Die Bilder der eigenen
 * Sammlung zeigen, welche Sets jemand besitzt. Klartext älterer Fassungen wird
 * verworfen, eine Datei unter fremdem Namen gilt nicht. Ausgeführt gegen ein
 * echtes Verzeichnis.
 *
 * Gegenproben:
 *   A  schreibe() legt die Bytes wieder unverschlüsselt ab und lies() gibt sie roh
 *      zurück → rot „ein Vorschaubild liegt nicht im Klartext …“;
 *      gegenproben/vorschau-klartext.patch
 *   B  im Ordner-Aufbau das Löschen der Klartext-Dateien entfernt → rot „Klartext
 *      aelterer Fassungen verschwindet …“
 */
class VorschauVerschluesseltTest {

    private val wurzel = File(System.getProperty("java.io.tmpdir"), "bim-vorschau-${System.nanoTime()}")
    private val adresse = "https://brick.example/api/v1/images/set/75192-1?thumb=1"
    private val bild = "JPEG-75192-Millennium-Falcon".toByteArray()

    private fun speicher() = VorschauSpeicher({ wurzel }, AblageChiffre { ByteArray(32) { 3 } })

    @After
    fun zu() { wurzel.deleteRecursively() }

    private fun klartextIrgendwo(): Boolean = wurzel.walkTopDown().filter { it.isFile }
        .any { String(it.readBytes(), Charsets.ISO_8859_1).contains("75192-Millennium") }

    @Test
    fun `ein Vorschaubild liegt nicht im Klartext und kommt unveraendert zurueck`() {
        val s = speicher()
        s.schreibe(adresse, bild)
        assertTrue(s.hat(adresse))
        assertFalse("Das Bild liegt im Klartext auf der Platte", klartextIrgendwo())
        assertArrayEquals(bild, s.lies(adresse))
        assertArrayEquals("Ein neuer Prozess liest es ebenso", bild, speicher().lies(adresse))
    }

    @Test
    fun `Klartext aelterer Fassungen verschwindet beim ersten Zugriff`() {
        val alt = File(wurzel, "a".repeat(64)).apply { parentFile!!.mkdirs(); writeBytes(bild) }
        val s = speicher()
        assertNull(s.lies(adresse))
        assertFalse("Das Klartext-Bild der Vorfassung bleibt liegen", alt.exists())
        assertFalse(klartextIrgendwo())
    }

    @Test
    fun `eine Datei unter fremdem Namen gilt nicht und wird verworfen`() {
        val s = speicher()
        s.schreibe(adresse, bild)
        val andere = "https://brick.example/api/v1/images/set/10179-1?thumb=1"
        val echt = wurzel.walkTopDown().single { it.isFile }
        s.schreibe(andere, "x".toByteArray())
        val ziel = wurzel.walkTopDown().single { it.isFile && it != echt }
        echt.copyTo(ziel, overwrite = true)
        assertNull("Das Bild eines anderen Sets gilt nicht als dieses", s.lies(andere))
        assertFalse("Die unlesbare Datei bleibt liegen und gilt beim Vorwärmen als da", s.hat(andere))
    }
}
