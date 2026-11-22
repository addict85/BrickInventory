package ch.brickinventoryapp.data

import ch.brickinventoryapp.data.util.PART_LIST_DEADLINE_MS
import ch.brickinventoryapp.data.util.PART_LIST_FILE
import ch.brickinventoryapp.data.util.PartListVault
import ch.brickinventoryapp.data.util.cleanOldPartListOn
import ch.brickinventoryapp.data.util.cleanUpAccountFiles
import ch.brickinventoryapp.data.util.partListsStore
import ch.brickinventoryapp.data.util.readFromStorage
import ch.brickinventoryapp.security.StoreCipher
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
 * Counter-check: in cleanUpAccountFiles() the line for
 * UPDATE_FOLDER removed → red “sign-out clears …” („Das geladene Update bleibt liegen“).
 * Counter-check: in
 * cleanOldPartListOn() the age check reversed (`<` instead of `>=`) → red “after
 * the deadline the parts list disappears …”; counter-checks/teileliste-bleibt-liegen.patch
 * Counter-check: Teilelistentresor.lege()
 * writes the plaintext instead of the ciphertext → red “the parts list lies only
 * encrypted …”; counter-checks/teileliste-im-klartext.patch
 */
class PartListsStoreTest {

    private val root = File(System.getProperty("java.io.tmpdir"), "bim-teile-${System.nanoTime()}")
    private val intern = File(root, "files")
    private val extern = File(root, "extern")

    @After
    fun tearDown() { root.deleteRecursively() }

    @Test
    fun `the parts list lies internally, an old external copy disappears`() {
        val old = File(extern, "pdf/teileliste.pdf").apply { parentFile!!.mkdirs(); writeText("Inventar") }
        val plaintext = File(intern, "pdf/teileliste.pdf").apply { parentFile!!.mkdirs(); writeText("Inventar") }
        val target = partListsStore(intern, extern)
        assertEquals(File(intern, "pdf/$PART_LIST_FILE"), target)
        assertEquals("pdf/ angelegt", true, target.parentFile!!.isDirectory)
        assertFalse("Die alte Kopie im externen Bereich bleibt liegen", old.exists())
        assertFalse("Die Klartext-Liste älterer Fassungen bleibt liegen", plaintext.exists())
    }

    @Test
    fun `sign-out clears parts list, shared PDFs and update, other things stay`() {
        val list = partListsStore(intern, extern).apply { writeText("Inventar") }
        val apk = File(intern, "update/BrickInventory.apk").apply { parentFile!!.mkdirs(); writeText("apk") }
        val shared = File(extern, "pdf/anleitung.pdf").apply { parentFile!!.mkdirs(); writeText("pdf") }
        val stays = File(intern, "datastore/einstellungen.pb").apply { parentFile!!.mkdirs(); writeText("x") }
        cleanUpAccountFiles(intern, extern)
        assertFalse("Die Teileliste überlebt das Abmelden", list.exists())
        assertFalse("Das geladene Update bleibt liegen", apk.exists())
        assertFalse("Geteilte PDFs im externen Bereich bleiben", shared.exists())
        assertTrue("Anderes in filesDir gehört nicht dazu", stays.exists())
        cleanUpAccountFiles(intern, null)
    }

    /** The inventory only as long as someone wants to open the list. */
    @Test
    fun `after the deadline the parts list disappears, a fresh one stays`() {
        val list = partListsStore(intern, null).apply { writeText("Inventar") }
        val old = File(intern, "pdf/teileliste.pdf").apply { writeText("Inventar") }
        val written = list.lastModified()
        assertFalse("Eine frische Teileliste bleibt für die Ziel-App",
            cleanOldPartListOn(intern, written + PART_LIST_DEADLINE_MS - 1000))
        assertTrue(list.exists())
        assertFalse("Die Klartext-Liste älterer Fassungen bleibt liegen", old.exists())
        assertTrue(cleanOldPartListOn(intern, written + PART_LIST_DEADLINE_MS))
        assertFalse("Das Inventar liegt nach der Frist noch da", list.exists())
        assertFalse("Ohne Datei nichts zu tun", cleanOldPartListOn(intern, written + PART_LIST_DEADLINE_MS))
    }

    @Test
    fun `without external storage the same target`() {
        assertEquals(File(intern, "pdf/$PART_LIST_FILE"), partListsStore(intern, null))
    }

    @Test
    fun `the parts list lies only encrypted, reading returns the plaintext`() {
        val key = ByteArray(32) { it.toByte() }
        val vault = PartListVault(StoreCipher { key })
        val pdf = "%PDF-1.7 Inventar 10294-1 Titanic".toByteArray()
        val file = vault.put(intern, extern, pdf)
        val raw = file.readBytes()
        assertFalse("Das Inventar steht im Klartext auf der Platte",
            String(raw, Charsets.ISO_8859_1).contains("Inventar"))
        assertArrayEquals(pdf, vault.read(intern))
        assertFalse("Die Zwischendatei bleibt liegen", File(file.parentFile, file.name + ".tmp").exists())

        val foreign = PartListVault(StoreCipher { ByteArray(32) { 7 } })
        assertNull("Ein anderer Schlüssel liest die Liste", foreign.read(intern))
        file.writeBytes(raw.copyOf(raw.size - 1))
        assertNull("Eine gekürzte Liste gilt", vault.read(intern))
        file.delete()
        assertNull(vault.read(intern))
    }

    @Test
    fun `the storage reader delivers every range and nothing at the end`() {
        val content = ByteArray(10) { it.toByte() }
        val target = ByteArray(4)
        assertEquals(4, readFromStorage(content, 0, 4, target))
        assertArrayEquals(byteArrayOf(0, 1, 2, 3), target)
        assertEquals("Ab der Mitte springen", 2, readFromStorage(content, 8, 4, target))
        assertArrayEquals(byteArrayOf(8, 9), target.copyOf(2))
        assertEquals("Am Ende nichts mehr", 0, readFromStorage(content, 10, 4, target))
    }
}
