package ch.brickinventoryapp.offline

import ch.brickinventoryapp.offline.room.istKlartextDatenbank
import ch.brickinventoryapp.offline.room.sqlcipherPasswort
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

/**
 * Der Bestand liegt mit SQLCipher verschlüsselt: Das Passwort ist der fertige
 * Schlüssel als Hex-Literal (kein zweites Ableiten in SQLCipher), und ein
 * Klartext-Altbestand wird an seinem Dateikopf erkannt.
 *
 * Gegenprobe (misst die CI; SQLCipher fehlt lokal): gegenproben/bestand-kopf-ungeprueft.patch,
 * istKlartextDatenbank() ohne Vergleich mit dem Kopf → rot „die Datenbank bekommt einen
 * fertigen Schluessel …“ (die verschlüsselte Datei gälte als Klartext).
 */
class BestandSchluesselTest {

    private val ordner = File(System.getProperty("java.io.tmpdir"), "bim-bestand-${System.nanoTime()}").apply { mkdirs() }

    @After
    fun zu() {
        ordner.deleteRecursively()
    }

    @Test
    fun `die Datenbank bekommt einen fertigen Schluessel und erkennt Klartext`() {
        val schluessel = ByteArray(32) { it.toByte() }
        val p = String(sqlcipherPasswort(schluessel), Charsets.US_ASCII)
        assertEquals("x'000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f'", p)
        val klar = File(ordner, "bestand.db").apply { writeBytes("SQLite format 3\u0000".toByteArray() + ByteArray(100)) }
        assertTrue(istKlartextDatenbank(klar))
        val verschluesselt = File(ordner, "neu.db").apply { writeBytes(ByteArray(116) { (it * 7).toByte() }) }
        assertFalse(istKlartextDatenbank(verschluesselt))
        assertFalse(istKlartextDatenbank(File(ordner, "fehlt.db")))
    }
}
