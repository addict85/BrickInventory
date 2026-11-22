package ch.brickinventoryapp.login

import ch.brickinventoryapp.login.ui.qrAdoptable
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * A QR sign-in only goes out after an explicit yes to the shown destination,
 * for every code, even without a fingerprint.
 *
 * Counter-check (14.11.2026, kotlinc and local JUnit):
 *   A  qrAdoptable() without `targetConfirmed &&` → red “without a yes to the destination …”;
 *      counter-checks/qr-target-without-yes.patch
 */
class QrTargetTest {

    @Test
    fun `without a yes to the target nothing goes out, even without typing`() {
        assertFalse(qrAdoptable(locked = false, targetConfirmed = false, type = false, input = ""))
        assertFalse(qrAdoptable(locked = false, targetConfirmed = false, type = true, input = "3F:A2"))
        assertTrue(qrAdoptable(locked = false, targetConfirmed = true, type = false, input = ""))
    }

    @Test
    fun `with a yes lock and typing still apply`() {
        assertFalse("Plaintext address", qrAdoptable(locked = true, targetConfirmed = true, type = false, input = ""))
        assertFalse("Nothing typed off", qrAdoptable(locked = false, targetConfirmed = true, type = true, input = " "))
        assertTrue(qrAdoptable(locked = false, targetConfirmed = true, type = true, input = "3F:A2"))
    }
}
