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
 *   A  gilt() mit `<=` statt `<` → rot „after one minute it asks again“
 *   B  vergiss() ohne Wirkung → rot „whoever leaves the app is asked again“
 *   C  gilt() ohne Bestätigung `true` (`bis?.let { … } != false`) → rot „ohne
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
