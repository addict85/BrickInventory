package ch.brickinventoryapp.ui

import ch.brickinventoryapp.ui.components.Bestaetigungsfrist
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Wie lange eine Bestätigung per Gerätesperre trägt (ui/components/Schrittschutz).
 * Die Abfrage selbst (BiometricPrompt) braucht ein Gerät; die Gutscheinseite prüft
 * AblaufTest mit einem Schrittschutz, der nie bestätigt.
 *
 * Gegenproben:
 *   A  gilt() mit `<=` statt `<` → rot „nach einer Minute wird wieder gefragt“
 *   B  vergiss() ohne Wirkung → rot „wer die App verlaesst, wird wieder gefragt“
 *   C  gilt() ohne Bestätigung `true` (`bis?.let { … } != false`) → rot „ohne
 *      Bestaetigung gilt nichts“ und „wer die App verlaesst …“
 */
class BestaetigungsfristTest {

    private var jetzt = 1_000L
    private val deadline = Bestaetigungsfrist(durationMs = 60_000, clock = { jetzt })

    @Test
    fun `ohne Bestaetigung gilt nichts`() {
        assertFalse(deadline.gilt())
    }

    @Test
    fun `nach einer Minute wird wieder gefragt`() {
        deadline.confirmed()
        jetzt += 59_999
        assertTrue(deadline.gilt())
        jetzt += 1
        assertFalse(deadline.gilt())
    }

    @Test
    fun `wer die App verlaesst, wird wieder gefragt`() {
        deadline.confirmed()
        deadline.vergiss()
        assertFalse(deadline.gilt())
    }
}
