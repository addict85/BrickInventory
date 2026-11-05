package ch.brickinventoryapp

import ch.brickinventoryapp.util.AblageChiffre
import ch.brickinventoryapp.util.TEILELISTE_DATEI
import ch.brickinventoryapp.util.TEILELISTE_FRIST_MS
import ch.brickinventoryapp.util.Teilelistentresor
import ch.brickinventoryapp.util.liesAusSpeicher
import ch.brickinventoryapp.util.raeumeAlteTeilelisteAuf
import ch.brickinventoryapp.util.raeumeKontoDateienAuf
import ch.brickinventoryapp.util.teilelistenAblage
import org.junit.After
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

/**
 * Die exportierte Teileliste trägt das Inventar und liegt darum nur im
 * app-eigenen filesDir; eine Kopie älterer Fassungen im externen Bereich
 * verschwindet beim nächsten Export.
 *
 * Gegenprobe: in teilelistenAblage()
 * wieder `extern ?: intern` als Wurzel → rot „die Teileliste liegt intern …“.
 * Gegenprobe: in raeumeKontoDateienAuf() die Zeile für
 * UPDATE_ORDNER entfernt → rot „Abmelden raeumt …“ („Das geladene Update bleibt liegen“).
 * Gegenprobe: in
 * raeumeAlteTeilelisteAuf() die Altersprüfung umgedreht (`<` statt `>=`) → rot „nach
 * der Frist verschwindet die Teileliste …“; gegenproben/teileliste-bleibt-liegen.patch
 * Gegenprobe: Teilelistentresor.lege()
 * schreibt den Klartext statt des Geheimtexts → rot „die Teileliste liegt nur
 * verschlüsselt …“; gegenproben/teileliste-im-klartext.patch
 */
class TeilelistenAblageTest {

    private val wurzel = File(System.getProperty("java.io.tmpdir"), "bim-teile-${System.nanoTime()}")
    private val intern = File(wurzel, "files")
    private val extern = File(wurzel, "extern")

    @After
    fun zu() { wurzel.deleteRecursively() }

    @Test
    fun `die Teileliste liegt intern, eine alte externe Kopie verschwindet`() {
        val alt = File(extern, "pdf/teileliste.pdf").apply { parentFile!!.mkdirs(); writeText("Inventar") }
        val klartext = File(intern, "pdf/teileliste.pdf").apply { parentFile!!.mkdirs(); writeText("Inventar") }
        val ziel = teilelistenAblage(intern, extern)
        assertEquals(File(intern, "pdf/$TEILELISTE_DATEI"), ziel)
        assertEquals("pdf/ angelegt", true, ziel.parentFile!!.isDirectory)
        assertFalse("Die alte Kopie im externen Bereich bleibt liegen", alt.exists())
        assertFalse("Die Klartext-Liste älterer Fassungen bleibt liegen", klartext.exists())
    }

    @Test
    fun `Abmelden raeumt Teileliste, geteilte PDFs und Update weg, anderes bleibt`() {
        val liste = teilelistenAblage(intern, extern).apply { writeText("Inventar") }
        val apk = File(intern, "update/BrickInventory.apk").apply { parentFile!!.mkdirs(); writeText("apk") }
        val geteilt = File(extern, "pdf/anleitung.pdf").apply { parentFile!!.mkdirs(); writeText("pdf") }
        val bleibt = File(intern, "datastore/einstellungen.pb").apply { parentFile!!.mkdirs(); writeText("x") }
        raeumeKontoDateienAuf(intern, extern)
        assertFalse("Die Teileliste überlebt das Abmelden", liste.exists())
        assertFalse("Das geladene Update bleibt liegen", apk.exists())
        assertFalse("Geteilte PDFs im externen Bereich bleiben", geteilt.exists())
        assertTrue("Anderes in filesDir gehört nicht dazu", bleibt.exists())
        raeumeKontoDateienAuf(intern, null)
    }

    /** Das Inventar nur, solange jemand die Liste öffnen will. */
    @Test
    fun `nach der Frist verschwindet die Teileliste, eine frische bleibt`() {
        val liste = teilelistenAblage(intern, null).apply { writeText("Inventar") }
        val alt = File(intern, "pdf/teileliste.pdf").apply { writeText("Inventar") }
        val geschrieben = liste.lastModified()
        assertFalse("Eine frische Teileliste bleibt für die Ziel-App",
            raeumeAlteTeilelisteAuf(intern, geschrieben + TEILELISTE_FRIST_MS - 1000))
        assertTrue(liste.exists())
        assertFalse("Die Klartext-Liste älterer Fassungen bleibt liegen", alt.exists())
        assertTrue(raeumeAlteTeilelisteAuf(intern, geschrieben + TEILELISTE_FRIST_MS))
        assertFalse("Das Inventar liegt nach der Frist noch da", liste.exists())
        assertFalse("Ohne Datei nichts zu tun", raeumeAlteTeilelisteAuf(intern, geschrieben + TEILELISTE_FRIST_MS))
    }

    @Test
    fun `ohne externen Speicher dasselbe Ziel`() {
        assertEquals(File(intern, "pdf/$TEILELISTE_DATEI"), teilelistenAblage(intern, null))
    }

    @Test
    fun `die Teileliste liegt nur verschluesselt, lesen gibt den Klartext`() {
        val schluessel = ByteArray(32) { it.toByte() }
        val tresor = Teilelistentresor(AblageChiffre { schluessel })
        val pdf = "%PDF-1.7 Inventar 10294-1 Titanic".toByteArray()
        val datei = tresor.lege(intern, extern, pdf)
        val roh = datei.readBytes()
        assertFalse("Das Inventar steht im Klartext auf der Platte",
            String(roh, Charsets.ISO_8859_1).contains("Inventar"))
        assertArrayEquals(pdf, tresor.lies(intern))
        assertFalse("Die Zwischendatei bleibt liegen", File(datei.parentFile, datei.name + ".tmp").exists())

        val fremd = Teilelistentresor(AblageChiffre { ByteArray(32) { 7 } })
        assertNull("Ein anderer Schlüssel liest die Liste", fremd.lies(intern))
        datei.writeBytes(roh.copyOf(roh.size - 1))
        assertNull("Eine gekürzte Liste gilt", tresor.lies(intern))
        datei.delete()
        assertNull(tresor.lies(intern))
    }

    @Test
    fun `der Speicherleser liefert jeden Bereich und am Ende nichts`() {
        val inhalt = ByteArray(10) { it.toByte() }
        val ziel = ByteArray(4)
        assertEquals(4, liesAusSpeicher(inhalt, 0, 4, ziel))
        assertArrayEquals(byteArrayOf(0, 1, 2, 3), ziel)
        assertEquals("Ab der Mitte springen", 2, liesAusSpeicher(inhalt, 8, 4, ziel))
        assertArrayEquals(byteArrayOf(8, 9), ziel.copyOf(2))
        assertEquals("Am Ende nichts mehr", 0, liesAusSpeicher(inhalt, 10, 4, ziel))
    }
}
