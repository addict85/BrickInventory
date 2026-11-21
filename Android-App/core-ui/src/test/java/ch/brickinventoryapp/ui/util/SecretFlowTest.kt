package ch.brickinventoryapp.ui.util

import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * Wann ein kopiertes Geheimnis aus der Zwischenablage verschwindet: nach Ablauf,
 * nur unser eigener Clip, und nie blind, wenn die Ablage nicht lesbar ist.
 *
 * Gegenproben:
 *   A  `!lesbar` aus der WARTEN-Bedingung entfernt → rot „im Hintergrund …“
 *      (FORGOTTEN statt WARTEN: Das Geheimnis bliebe für immer liegen)
 *   B  der Vergleich `idInClip == kennung` durch `true` ersetzt → rot
 *      „foreign content is not cleared“
 */
class SecretFlowTest {

    @Test
    fun `before expiry it waits, afterwards the own clip is cleared`() {
        assertEquals(SecretStep.WARTEN, secretStep("k1", 1000, 999, lesbar = true, idInClip = "k1"))
        assertEquals(SecretStep.LEEREN, secretStep("k1", 1000, 1000, lesbar = true, idInClip = "k1"))
    }

    @Test
    fun `foreign content is not cleared`() {
        assertEquals(SecretStep.FORGOTTEN, secretStep("k1", 1000, 2000, lesbar = true, idInClip = null))
        assertEquals(SecretStep.FORGOTTEN, secretStep("k1", 1000, 2000, lesbar = true, idInClip = "k2"))
    }

    @Test
    fun `in the background it waits until the clipboard is readable`() {
        assertEquals(SecretStep.WARTEN, secretStep("k1", 1000, 2000, lesbar = false, idInClip = null))
    }

    @Test
    fun `without an open secret there is nothing to do`() {
        assertEquals(SecretStep.FORGOTTEN, secretStep(null, 0, 2000, lesbar = true, idInClip = "k1"))
    }
}
