package ch.brickinventoryapp.login

import ch.brickinventoryapp.login.ui.qrUebernehmbar
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * A QR sign-in only goes out after an explicit yes to the shown destination,
 * for every code, even without a fingerprint.
 *
 * Counter-check (14.11.2026, kotlinc and local JUnit):
 *   A  qrUebernehmbar() without `targetConfirmed &&` → red “without a yes to the destination …”;
 *      gegenproben/qr-ziel-ohne-ja.patch
 */
class QrTargetTest {

    @Test
    fun `without a yes to the target nothing goes out, even without typing`() {
        assertFalse(qrUebernehmbar(gesperrt = false, targetConfirmed = false, abtippen = false, eingabe = ""))
        assertFalse(qrUebernehmbar(gesperrt = false, targetConfirmed = false, abtippen = true, eingabe = "3F:A2"))
        assertTrue(qrUebernehmbar(gesperrt = false, targetConfirmed = true, abtippen = false, eingabe = ""))
    }

    @Test
    fun `with a yes lock and typing still apply`() {
        assertFalse("Klartext-Adresse", qrUebernehmbar(gesperrt = true, targetConfirmed = true, abtippen = false, eingabe = ""))
        assertFalse("Nichts abgetippt", qrUebernehmbar(gesperrt = false, targetConfirmed = true, abtippen = true, eingabe = " "))
        assertTrue(qrUebernehmbar(gesperrt = false, targetConfirmed = true, abtippen = true, eingabe = "3F:A2"))
    }
}
