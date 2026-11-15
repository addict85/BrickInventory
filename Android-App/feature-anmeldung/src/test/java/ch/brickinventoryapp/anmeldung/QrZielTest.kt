package ch.brickinventoryapp.anmeldung

import ch.brickinventoryapp.anmeldung.ui.qrUebernehmbar
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Eine QR-Anmeldung geht erst nach dem ausdrücklichen Ja zum gezeigten Ziel hinaus,
 * bei jedem Code, auch ohne Fingerabdruck.
 *
 * Gegenprobe (14.11.2026, kotlinc und JUnit lokal):
 *   A  qrUebernehmbar() ohne `zielBestaetigt &&` → rot „ohne Ja zum Ziel …“;
 *      gegenproben/qr-ziel-ohne-ja.patch
 */
class QrZielTest {

    @Test
    fun `ohne Ja zum Ziel geht nichts hinaus, auch ohne Abtippen`() {
        assertFalse(qrUebernehmbar(gesperrt = false, zielBestaetigt = false, abtippen = false, eingabe = ""))
        assertFalse(qrUebernehmbar(gesperrt = false, zielBestaetigt = false, abtippen = true, eingabe = "3F:A2"))
        assertTrue(qrUebernehmbar(gesperrt = false, zielBestaetigt = true, abtippen = false, eingabe = ""))
    }

    @Test
    fun `mit Ja gelten Sperre und Abtippen weiter`() {
        assertFalse("Klartext-Adresse", qrUebernehmbar(gesperrt = true, zielBestaetigt = true, abtippen = false, eingabe = ""))
        assertFalse("Nichts abgetippt", qrUebernehmbar(gesperrt = false, zielBestaetigt = true, abtippen = true, eingabe = " "))
        assertTrue(qrUebernehmbar(gesperrt = false, zielBestaetigt = true, abtippen = true, eingabe = "3F:A2"))
    }
}
