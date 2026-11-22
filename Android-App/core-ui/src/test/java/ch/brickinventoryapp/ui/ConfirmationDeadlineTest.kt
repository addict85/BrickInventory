package ch.brickinventoryapp.ui

import ch.brickinventoryapp.ui.components.ConfirmationDeadline
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * How long a device-lock confirmation lasts (ui/components/Schrittschutz).
 * The prompt itself (BiometricPrompt) needs a device; the voucher page checks
 * expiry with a step guard that never confirms.
 *
 * Counter-checks:
 *   A  applies() with `<=` instead of `<` → red „after one minute it asks again“
 *   B  forgetNow() without effect → red „whoever leaves the app is asked again“
 *   C  applies() without confirmation `true` (`until?.let { … } != false`) → red „ohne
 *      Bestaetigung gilt nichts“ und „wer die App verlaesst …“
 */
class ConfirmationDeadlineTest {

    private var now = 1_000L
    private val deadline = ConfirmationDeadline(durationMs = 60_000, clock = { now })

    @Test
    fun `without confirmation nothing applies`() {
        assertFalse(deadline.applies())
    }

    @Test
    fun `after one minute it asks again`() {
        deadline.confirmed()
        now += 59_999
        assertTrue(deadline.applies())
        now += 1
        assertFalse(deadline.applies())
    }

    @Test
    fun `whoever leaves the app is asked again`() {
        deadline.confirmed()
        deadline.forgetNow()
        assertFalse(deadline.applies())
    }
}
