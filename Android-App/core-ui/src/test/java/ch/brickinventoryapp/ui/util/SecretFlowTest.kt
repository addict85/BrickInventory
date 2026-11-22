package ch.brickinventoryapp.ui.util

import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * When a copied secret disappears from the clipboard: after expiry,
 * only our own clip, and never blindly when the clipboard is not readable.
 *
 * Counter-checks:
 *   A  `!readable` removed from the WAIT condition → red „im Hintergrund …“
 *      (FORGOTTEN instead of WAIT: the secret would stay there forever)
 *   B  the comparison `idInClip == identifier` replaced by `true` → red
 *      „foreign content is not cleared“
 */
class SecretFlowTest {

    @Test
    fun `before expiry it waits, afterwards the own clip is cleared`() {
        assertEquals(SecretStep.WAIT, secretStep("k1", 1000, 999, readable = true, idInClip = "k1"))
        assertEquals(SecretStep.CLEAR, secretStep("k1", 1000, 1000, readable = true, idInClip = "k1"))
    }

    @Test
    fun `foreign content is not cleared`() {
        assertEquals(SecretStep.FORGOTTEN, secretStep("k1", 1000, 2000, readable = true, idInClip = null))
        assertEquals(SecretStep.FORGOTTEN, secretStep("k1", 1000, 2000, readable = true, idInClip = "k2"))
    }

    @Test
    fun `in the background it waits until the clipboard is readable`() {
        assertEquals(SecretStep.WAIT, secretStep("k1", 1000, 2000, readable = false, idInClip = null))
    }

    @Test
    fun `without an open secret there is nothing to do`() {
        assertEquals(SecretStep.FORGOTTEN, secretStep(null, 0, 2000, readable = true, idInClip = "k1"))
    }
}
