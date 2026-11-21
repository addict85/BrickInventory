package ch.brickinventoryapp.security

import org.junit.After
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test
import java.io.File
import java.io.IOException
import java.util.Base64

/**
 * Der Ablageschlüssel (Bestand, Kaufpreise, Ausgang) liegt unter dem Keystore-Schlüssel, der nur
 * entsperrt arbeitet (EntsperrVault). Ein Altbestand unter dem Schlüssel ohne Bedingung wird beim
 * ersten lesbaren Zugriff umgeschlüsselt, ohne dass eine Ablage unlesbar wird; gesperrt entsteht
 * kein neuer Schlüssel, und eine Ablage meldet „gesperrt“ statt „unlesbar“ (sonst löschte sie).
 * Neu verschlüsselt wird nur noch unter der Entsperr-Bedingung, nie mit einem Ausweg.
 *
 * Gegenproben (kotlinc und JUnit lokal):
 *   A  in hole() `if (tresor.veraltet(umhuellt)) wrapNew(…)` gestrichen → rot „ein Altbestand
 *      … kommt beim ersten Lesen unter den entsperrten …“; gegenproben/ablage-bleibt-ohne-sperre.patch
 *   C  in StoreCipher.oeffne() den Schlüssel wieder in runCatching → rot „gesperrt entsteht kein
 *      neuer Schluessel …“ (null statt IOException); gegenproben/ablage-gesperrt-wie-unlesbar.patch
 *   D  EntsperrVault.verschluessle() weicht wieder auf den Altbestand-Schlüssel aus → rot
 *      „locked the unlock vault stores nothing under the weaker key“;
 *      gegenproben/entsperrtresor-mit-ausweg.patch
 *   E  erneuere() ruft hole() ohne fangeAusserAbbruch → rot „Abmelden bei gesperrtem Geraet …“;
 *      gegenproben/ablage-erneuern-gesperrt-wirft.patch
 */
class StoreUnlockedTest {

    private val folder = File(System.getProperty("java.io.tmpdir"), "bim-entsperrt-${System.nanoTime()}").apply { mkdirs() }
    private val datei = File(folder, "ablage.schluessel")

    /** Was der Ablageschlüssel geschrieben hat: ein Ergebnis des Laufs, kein Quelltext. */
    private fun abgelegt() = datei.readBytes().decodeToString()

    @After
    fun zu() {
        folder.deleteRecursively()
    }

    /**
     * Wie ein Keystore-Schlüssel: jedes Mal ein anderer Geheimtext (wie mit neuem IV), [gesperrt] wie
     * bei gesperrtem Gerät, [kaputt]: verschlüsseln geht nicht.
     */
    private class Probetresor(private val marke: String) : TokenEncryption {
        var gesperrt = false
        var kaputt = false
        private var iv = 0
        override fun verschluessle(klartext: String): String {
            check(!gesperrt && !kaputt) { "$marke gerade nicht" }
            return marke + (iv++) + "." + Base64.getEncoder().encodeToString(klartext.toByteArray())
        }
        override fun entschluessle(gespeichert: String): String? = (oeffne(gespeichert) as? Tresorbefund.Readable)?.klartext
        override fun oeffne(gespeichert: String): Tresorbefund = when {
            gesperrt -> Tresorbefund.Gesperrt
            !gespeichert.startsWith(marke) -> Tresorbefund.Weg
            else -> Tresorbefund.Readable(String(Base64.getDecoder().decode(gespeichert.substringAfter("."))))
        }
    }

    private val entsperrt = Probetresor("n:")
    private val immer = Probetresor("i:")
    private fun neu() = Ablageschluessel(datei, EntsperrVault(entsperrt, immer))

    /** Der Stand vor dieser Fassung: Schlüssel unter `brickinventory_ablage`, eine Ablage damit verschlüsselt. */
    private fun altbestand(): Pair<ByteArray, ByteArray> {
        val alt = Ablageschluessel(datei, immer)
        val geheim = StoreCipher { alt.fuer("bestand") }.verschluessle("Kaufpreis 499.99".toByteArray(), "b")
        return alt.fetch() to geheim
    }

    @Test
    fun `a legacy stock without condition goes under the unlocked one on first read, the stores stay readable`() {
        val (schluessel, geheim) = altbestand()
        val k = neu()
        assertArrayEquals("Derselbe Schlüssel, nur anders umhüllt", schluessel, k.fetch())
        assertTrue("Jetzt unter dem Schlüssel mit Entsperr-Bedingung", abgelegt().startsWith(UNLOCKED_PREFIX + "n:"))
        assertFalse(k.newCreated)
        assertEquals("Kaufpreis 499.99", String(StoreCipher { neu().fuer("bestand") }.entschluessle(geheim, "b")!!))
    }

    @Test
    fun `locked no new key is created, the store reports locked instead of unreadable`() {
        val (_, geheim) = altbestand()
        neu().fetch()
        val vorher = abgelegt()
        entsperrt.gesperrt = true
        try {
            neu().fetch()
            fail("Gesperrt darf kein Schlüssel herauskommen")
        } catch (_: IOException) {
            // erwartet: Keystore gerade nicht bereit
        }
        assertEquals("Nichts neu angelegt", vorher, abgelegt())
        try {
            StoreCipher { neu().fuer("bestand") }.entschluessle(geheim, "b")
            fail("Gesperrt hiesse sonst unlesbar, und die Ablage würde gelöscht")
        } catch (_: IOException) {
            // erwartet
        }
        entsperrt.gesperrt = false
        assertEquals("Kaufpreis 499.99", String(StoreCipher { neu().fuer("bestand") }.entschluessle(geheim, "b")!!))
    }

    @Test
    fun `if the unlocked vault cannot encrypt, the old one stays and keeps applying`() {
        val (schluessel, _) = altbestand()
        val vorher = abgelegt()
        entsperrt.kaputt = true
        assertArrayEquals(schluessel, neu().fetch())
        assertEquals("Ohne Not nicht neu geschrieben", vorher, abgelegt())
        entsperrt.kaputt = false
        neu().fetch()
        assertTrue("Beim nächsten Start umgeschlüsselt", abgelegt().startsWith(UNLOCKED_PREFIX))
    }

    @Test
    fun `locked the unlock vault stores nothing under the weaker key`() {
        val tresor = EntsperrVault(entsperrt, immer)
        entsperrt.gesperrt = true
        try {
            tresor.verschluessle("neu-getauscht")
            fail("Gesperrt darf kein Geheimtext unter dem Schlüssel ohne Bedingung entstehen")
        } catch (_: IllegalStateException) {
            // erwartet: der Entsperr-Schlüssel arbeitet gerade nicht
        }
        entsperrt.gesperrt = false
        assertTrue(tresor.verschluessle("neu-getauscht").startsWith(UNLOCKED_PREFIX + "n:"))
    }

    @Test
    fun `sign-out with a locked device deletes the old key, the new one exists only when unlocked`() {
        val k = neu()
        val alt = k.fetch()
        entsperrt.gesperrt = true
        k.renew()
        assertFalse("Der alte Schlüssel ist weg", datei.exists())
        try {
            k.fetch()
            fail("Gesperrt entsteht kein neuer Schlüssel")
        } catch (_: IOException) {
            // erwartet: später
        }
        entsperrt.gesperrt = false
        assertFalse("Ein neuer Schlüssel", alt.contentEquals(k.fetch()))
        assertTrue(abgelegt().startsWith(UNLOCKED_PREFIX + "n:"))
    }
}
