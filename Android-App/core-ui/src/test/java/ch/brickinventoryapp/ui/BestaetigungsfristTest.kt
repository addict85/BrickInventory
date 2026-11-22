package ch.brickinventoryapp.ui

import ch.brickinventoryapp.ui.components.Bestaetigungsfrist
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * How long a device-lock confirmation lasts (ui/components/Schrittschutz).
 * The prompt itself (BiometricPrompt) needs a device; the voucher page checks
 * expiry with a step guard that never confirms.
 *
 * Counter-checks:
 *   A  gilt() with `<=` instead of `<` → red „after one minute it asks again“
 *   B  vergiss() without effect → red „whoever leaves the app is asked again“
 *   C  gilt() without confirmation `true` (`bis?.let { … } != false`) → red „ohne
 *      Bestaetigung gilt nichts“ und „wer die App verlaesst …“
 */
class BestaetigungsfristTest {

    private var jetzt = 1_000L
    private val deadline = Bestaetigungsfrist(durationMs = 60_000, clock = { jetzt })

    @Test
    fun `without confirmation nothing applies`() {
        assertFalse(deadline.gilt())
    }

    @Test
    fun `after one minute it asks again`() {
        deadline.confirmed()
        jetzt += 59_999
        assertTrue(deadline.gilt())
        jetzt += 1
        assertFalse(deadline.gilt())
    }

    @Test
    fun `whoever leaves the app is asked again`() {
        deadline.confirmed()
        deadline.vergiss()
        assertFalse(deadline.gilt())
    }
}
