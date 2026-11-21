package ch.brickinventoryapp.data

import ch.brickinventoryapp.security.StoreCipher
import ch.brickinventoryapp.data.util.PART_LIST_FILE
import ch.brickinventoryapp.data.util.PART_LIST_DEADLINE_MS
import ch.brickinventoryapp.data.util.Teilelistentresor
import ch.brickinventoryapp.data.util.readFromStorage
import ch.brickinventoryapp.data.util.cleanOldPartListOn
import ch.brickinventoryapp.data.util.raeumeKontoDateienAuf
import ch.brickinventoryapp.data.util.partListsStore
import org.junit.After
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

/**
 * The exported parts list carries the inventory and therefore lies only in the
 * app's own filesDir; a copy of older versions in the external area
 * disappears at the next export.
 *
 * Counter-check: in partListsStore()
 * again `extern ?: intern` as root → red “the parts list lies internally …”.
 * Counter-check: in raeumeKontoDateienAuf() the line for
 * UPDATE_FOLDER removed → red “sign-out clears …” („Das geladene Update bleibt liegen“).
 * Counter-check: in
 * cleanOldPartListOn() the age check reversed (`<` instead of `>=`) → red “after
 * the deadline the parts list disappears …”; gegenproben/teileliste-bleibt-liegen.patch
 * Counter-check: Teilelistentresor.lege()
 * writes the plaintext instead of the ciphertext → red “the parts list lies only
 * encrypted …”; gegenproben/teileliste-im-klartext.patch
 */
class PartListsStoreTest {

    private val root = File(System.getProperty("java.io.tmpdir"), "bim-teile-${System.nanoTime()}")
    private val intern = File(root, "files")
    private val extern = File(root, "extern")

    @After
    fun zu() { root.deleteRecursively() }

    @Test
    fun `the parts list lies internally, an old external copy disappears`() {
        val alt = File(extern, "pdf/teileliste.pdf").apply { parentFile!!.mkdirs(); writeText("Inventar") }
        val klartext = File(intern, "pdf/teileliste.pdf").apply { parentFile!!.mkdirs(); writeText("Inventar") }
        val ziel = partListsStore(intern, extern)
        assertEquals(File(intern, "pdf/$PART_LIST_FILE"), ziel)
        assertEquals("pdf/ angelegt", true, ziel.parentFile!!.isDirectory)
        assertFalse("Die alte Kopie im externen Bereich bleibt liegen", alt.exists())
        assertFalse("Die Klartext-Liste älterer Fassungen bleibt liegen", klartext.exists())
    }

    @Test
    fun `sign-out clears parts list, shared PDFs and update, other things stay`() {
        val liste = partListsStore(intern, extern).apply { writeText("Inventar") }
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

    /** The inventory only as long as someone wants to open the list. */
    @Test
    fun `after the deadline the parts list disappears, a fresh one stays`() {
        val liste = partListsStore(intern, null).apply { writeText("Inventar") }
        val alt = File(intern, "pdf/teileliste.pdf").apply { writeText("Inventar") }
        val geschrieben = liste.lastModified()
        assertFalse("Eine frische Teileliste bleibt für die Ziel-App",
            cleanOldPartListOn(intern, geschrieben + PART_LIST_DEADLINE_MS - 1000))
        assertTrue(liste.exists())
        assertFalse("Die Klartext-Liste älterer Fassungen bleibt liegen", alt.exists())
        assertTrue(cleanOldPartListOn(intern, geschrieben + PART_LIST_DEADLINE_MS))
        assertFalse("Das Inventar liegt nach der Frist noch da", liste.exists())
        assertFalse("Ohne Datei nichts zu tun", cleanOldPartListOn(intern, geschrieben + PART_LIST_DEADLINE_MS))
    }

    @Test
    fun `without external storage the same target`() {
        assertEquals(File(intern, "pdf/$PART_LIST_FILE"), partListsStore(intern, null))
    }

    @Test
    fun `the parts list lies only encrypted, reading returns the plaintext`() {
        val schluessel = ByteArray(32) { it.toByte() }
        val tresor = Teilelistentresor(StoreCipher { schluessel })
        val pdf = "%PDF-1.7 Inventar 10294-1 Titanic".toByteArray()
        val datei = tresor.put(intern, extern, pdf)
        val roh = datei.readBytes()
        assertFalse("Das Inventar steht im Klartext auf der Platte",
            String(roh, Charsets.ISO_8859_1).contains("Inventar"))
        assertArrayEquals(pdf, tresor.lies(intern))
        assertFalse("Die Zwischendatei bleibt liegen", File(datei.parentFile, datei.name + ".tmp").exists())

        val fremd = Teilelistentresor(StoreCipher { ByteArray(32) { 7 } })
        assertNull("Ein anderer Schlüssel liest die Liste", fremd.lies(intern))
        datei.writeBytes(roh.copyOf(roh.size - 1))
        assertNull("Eine gekürzte Liste gilt", tresor.lies(intern))
        datei.delete()
        assertNull(tresor.lies(intern))
    }

    @Test
    fun `the storage reader delivers every range and nothing at the end`() {
        val inhalt = ByteArray(10) { it.toByte() }
        val ziel = ByteArray(4)
        assertEquals(4, readFromStorage(inhalt, 0, 4, ziel))
        assertArrayEquals(byteArrayOf(0, 1, 2, 3), ziel)
        assertEquals("Ab der Mitte springen", 2, readFromStorage(inhalt, 8, 4, ziel))
        assertArrayEquals(byteArrayOf(8, 9), ziel.copyOf(2))
        assertEquals("Am Ende nichts mehr", 0, readFromStorage(inhalt, 10, 4, ziel))
    }
}
