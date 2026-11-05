package ch.brickinventoryapp

import ch.brickinventoryapp.util.TEILELISTE_FRIST_MS
import ch.brickinventoryapp.util.raeumeAlteTeilelisteAuf
import ch.brickinventoryapp.util.raeumeKontoDateienAuf
import ch.brickinventoryapp.util.teilelistenAblage
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

/**
 * Die exportierte Teileliste trägt das Inventar und liegt darum nur im
 * app-eigenen filesDir; eine Kopie älterer Fassungen im externen Bereich
 * verschwindet beim nächsten Export.
 *
 * Gegenprobe (01.11.2026, gemessen mit kotlinc lokal): in teilelistenAblage()
 * wieder `extern ?: intern` als Wurzel → rot „die Teileliste liegt intern …“.
 * Gegenprobe (02.11.2026, gemessen): in raeumeKontoDateienAuf() die Zeile für
 * UPDATE_ORDNER entfernt → rot „Abmelden raeumt …“ („Das geladene Update bleibt liegen“).
 * Gegenprobe (04.11.2026, gemessen mit kotlinc lokal; sec11 N1): in
 * raeumeAlteTeilelisteAuf() die Altersprüfung umgedreht (`<` statt `>=`) → rot „nach
 * der Frist verschwindet die Teileliste …“; gegenproben/teileliste-bleibt-liegen.patch
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
    fun `Abmelden raeumt Teileliste, geteilte PDFs und Update weg, anderes bleibt`() {
        val liste = teilelistenAblage(intern, extern).apply { writeText("Inventar") }
        val apk = File(intern, "update/BrickInventory.apk").apply { parentFile.mkdirs(); writeText("apk") }
        val geteilt = File(extern, "pdf/anleitung.pdf").apply { parentFile.mkdirs(); writeText("pdf") }
        val bleibt = File(intern, "datastore/einstellungen.pb").apply { parentFile.mkdirs(); writeText("x") }
        raeumeKontoDateienAuf(intern, extern)
        assertFalse("Die Teileliste überlebt das Abmelden", liste.exists())
        assertFalse("Das geladene Update bleibt liegen", apk.exists())
        assertFalse("Geteilte PDFs im externen Bereich bleiben", geteilt.exists())
        assertTrue("Anderes in filesDir gehört nicht dazu", bleibt.exists())
        raeumeKontoDateienAuf(intern, null)
    }

    /** Klartext nur, solange die Ziel-App ihn lesen muss (sec11 N1). */
    @Test
    fun `nach der Frist verschwindet die Teileliste, eine frische bleibt`() {
        val liste = teilelistenAblage(intern, null).apply { writeText("Inventar") }
        val geschrieben = liste.lastModified()
        assertFalse("Eine frische Teileliste bleibt für die Ziel-App",
            raeumeAlteTeilelisteAuf(intern, geschrieben + TEILELISTE_FRIST_MS - 1000))
        assertTrue(liste.exists())
        assertTrue(raeumeAlteTeilelisteAuf(intern, geschrieben + TEILELISTE_FRIST_MS))
        assertFalse("Das Inventar liegt nach der Frist noch im Klartext", liste.exists())
        assertFalse("Ohne Datei nichts zu tun", raeumeAlteTeilelisteAuf(intern, geschrieben + TEILELISTE_FRIST_MS))
    }

    @Test
    fun `ohne externen Speicher dasselbe Ziel`() {
        assertEquals(File(intern, "pdf/teileliste.pdf"), teilelistenAblage(intern, null))
    }
}
