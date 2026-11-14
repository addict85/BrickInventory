package ch.brickinventoryapp.sicherheit

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
 * entsperrt arbeitet (EntsperrTresor). Ein Altbestand unter dem Schlüssel ohne Bedingung wird beim
 * ersten lesbaren Zugriff umgeschlüsselt, ohne dass eine Ablage unlesbar wird; gesperrt entsteht
 * kein neuer Schlüssel, und eine Ablage meldet „gesperrt“ statt „unlesbar“ (sonst löschte sie).
 * Neu verschlüsselt wird nur noch unter der Entsperr-Bedingung, nie mit einem Ausweg.
 *
 * Gegenproben (kotlinc und JUnit lokal):
 *   A  in hole() `if (tresor.veraltet(umhuellt)) umhuelleNeu(…)` gestrichen → rot „ein Altbestand
 *      … kommt beim ersten Lesen unter den entsperrten …“; gegenproben/ablage-bleibt-ohne-sperre.patch
 *   C  in AblageChiffre.oeffne() den Schlüssel wieder in runCatching → rot „gesperrt entsteht kein
 *      neuer Schluessel …“ (null statt IOException); gegenproben/ablage-gesperrt-wie-unlesbar.patch
 *   D  EntsperrTresor.verschluessle() weicht wieder auf den Altbestand-Schlüssel aus → rot
 *      „gesperrt legt der Entsperr-Tresor nichts unter dem schwaecheren Schluessel ab“;
 *      gegenproben/entsperrtresor-mit-ausweg.patch
 *   E  erneuere() ruft hole() ohne fangeAusserAbbruch → rot „Abmelden bei gesperrtem Geraet …“;
 *      gegenproben/ablage-erneuern-gesperrt-wirft.patch
 */
class AblageEntsperrtTest {

    private val ordner = File(System.getProperty("java.io.tmpdir"), "bim-entsperrt-${System.nanoTime()}").apply { mkdirs() }
    private val datei = File(ordner, "ablage.schluessel")

    /** Was der Ablageschlüssel geschrieben hat: ein Ergebnis des Laufs, kein Quelltext. */
    private fun abgelegt() = datei.readBytes().decodeToString()

    @After
    fun zu() {
        ordner.deleteRecursively()
    }

    /**
     * Wie ein Keystore-Schlüssel: jedes Mal ein anderer Geheimtext (wie mit neuem IV), [gesperrt] wie
     * bei gesperrtem Gerät, [kaputt]: verschlüsseln geht nicht.
     */
    private class Probetresor(private val marke: String) : TokenVerschluesselung {
        var gesperrt = false
        var kaputt = false
        private var iv = 0
        override fun verschluessle(klartext: String): String {
            check(!gesperrt && !kaputt) { "$marke gerade nicht" }
            return marke + (iv++) + "." + Base64.getEncoder().encodeToString(klartext.toByteArray())
        }
        override fun entschluessle(gespeichert: String): String? = (oeffne(gespeichert) as? Tresorbefund.Lesbar)?.klartext
        override fun oeffne(gespeichert: String): Tresorbefund = when {
            gesperrt -> Tresorbefund.Gesperrt
            !gespeichert.startsWith(marke) -> Tresorbefund.Weg
            else -> Tresorbefund.Lesbar(String(Base64.getDecoder().decode(gespeichert.substringAfter("."))))
        }
    }

    private val entsperrt = Probetresor("n:")
    private val immer = Probetresor("i:")
    private fun neu() = Ablageschluessel(datei, EntsperrTresor(entsperrt, immer))

    /** Der Stand vor dieser Fassung: Schlüssel unter `brickinventory_ablage`, eine Ablage damit verschlüsselt. */
    private fun altbestand(): Pair<ByteArray, ByteArray> {
        val alt = Ablageschluessel(datei, immer)
        val geheim = AblageChiffre { alt.fuer("bestand") }.verschluessle("Kaufpreis 499.99".toByteArray(), "b")
        return alt.hole() to geheim
    }

    @Test
    fun `ein Altbestand ohne Bedingung kommt beim ersten Lesen unter den entsperrten, die Ablagen bleiben lesbar`() {
        val (schluessel, geheim) = altbestand()
        val k = neu()
        assertArrayEquals("Derselbe Schlüssel, nur anders umhüllt", schluessel, k.hole())
        assertTrue("Jetzt unter dem Schlüssel mit Entsperr-Bedingung", abgelegt().startsWith(ENTSPERRT_PRAEFIX + "n:"))
        assertFalse(k.neuAngelegt)
        assertEquals("Kaufpreis 499.99", String(AblageChiffre { neu().fuer("bestand") }.entschluessle(geheim, "b")!!))
    }

    @Test
    fun `gesperrt entsteht kein neuer Schluessel, die Ablage meldet gesperrt statt unlesbar`() {
        val (_, geheim) = altbestand()
        neu().hole()
        val vorher = abgelegt()
        entsperrt.gesperrt = true
        try {
            neu().hole()
            fail("Gesperrt darf kein Schlüssel herauskommen")
        } catch (_: IOException) {
            // erwartet: Keystore gerade nicht bereit
        }
        assertEquals("Nichts neu angelegt", vorher, abgelegt())
        try {
            AblageChiffre { neu().fuer("bestand") }.entschluessle(geheim, "b")
            fail("Gesperrt hiesse sonst unlesbar, und die Ablage würde gelöscht")
        } catch (_: IOException) {
            // erwartet
        }
        entsperrt.gesperrt = false
        assertEquals("Kaufpreis 499.99", String(AblageChiffre { neu().fuer("bestand") }.entschluessle(geheim, "b")!!))
    }

    @Test
    fun `kann der entsperrte Tresor nicht verschluesseln, bleibt der alte und gilt weiter`() {
        val (schluessel, _) = altbestand()
        val vorher = abgelegt()
        entsperrt.kaputt = true
        assertArrayEquals(schluessel, neu().hole())
        assertEquals("Ohne Not nicht neu geschrieben", vorher, abgelegt())
        entsperrt.kaputt = false
        neu().hole()
        assertTrue("Beim nächsten Start umgeschlüsselt", abgelegt().startsWith(ENTSPERRT_PRAEFIX))
    }

    @Test
    fun `gesperrt legt der Entsperr-Tresor nichts unter dem schwaecheren Schluessel ab`() {
        val tresor = EntsperrTresor(entsperrt, immer)
        entsperrt.gesperrt = true
        try {
            tresor.verschluessle("neu-getauscht")
            fail("Gesperrt darf kein Geheimtext unter dem Schlüssel ohne Bedingung entstehen")
        } catch (_: IllegalStateException) {
            // erwartet: der Entsperr-Schlüssel arbeitet gerade nicht
        }
        entsperrt.gesperrt = false
        assertTrue(tresor.verschluessle("neu-getauscht").startsWith(ENTSPERRT_PRAEFIX + "n:"))
    }

    @Test
    fun `Abmelden bei gesperrtem Geraet loescht den alten Schluessel, den neuen gibt es erst entsperrt`() {
        val k = neu()
        val alt = k.hole()
        entsperrt.gesperrt = true
        k.erneuere()
        assertFalse("Der alte Schlüssel ist weg", datei.exists())
        try {
            k.hole()
            fail("Gesperrt entsteht kein neuer Schlüssel")
        } catch (_: IOException) {
            // erwartet: später
        }
        entsperrt.gesperrt = false
        assertFalse("Ein neuer Schlüssel", alt.contentEquals(k.hole()))
        assertTrue(abgelegt().startsWith(ENTSPERRT_PRAEFIX + "n:"))
    }
}
