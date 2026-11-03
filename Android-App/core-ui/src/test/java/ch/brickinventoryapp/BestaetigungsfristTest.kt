package ch.brickinventoryapp

import ch.brickinventoryapp.ui.components.Bestaetigungsfrist
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Wie lange eine Bestätigung per Gerätesperre trägt (ui/components/Schrittschutz).
 * Die Abfrage selbst (BiometricPrompt) braucht ein Gerät; die Gutscheinseite prüft
 * AblaufTest mit einem Schrittschutz, der nie bestätigt.
 *
 * Gegenproben (03.11.2026, gemessen mit kotlinc lokal):
 *   A  gilt() mit `<=` statt `<` → rot „nach einer Minute wird wieder gefragt“
 *   B  vergiss() ohne Wirkung → rot „wer die App verlaesst, wird wieder gefragt“
 *   C  gilt() ohne Bestätigung `true` (`bis?.let { … } != false`) → rot „ohne
 *      Bestaetigung gilt nichts“ und „wer die App verlaesst …“
 */
class BestaetigungsfristTest {

    private var jetzt = 1_000L
    private val frist = Bestaetigungsfrist(dauerMs = 60_000, uhr = { jetzt })

    @Test
    fun `ohne Bestaetigung gilt nichts`() {
        assertFalse(frist.gilt())
    }

    @Test
    fun `nach einer Minute wird wieder gefragt`() {
        frist.bestaetigt()
        jetzt += 59_999
        assertTrue(frist.gilt())
        jetzt += 1
        assertFalse(frist.gilt())
    }

    @Test
    fun `wer die App verlaesst, wird wieder gefragt`() {
        frist.bestaetigt()
        frist.vergiss()
        assertFalse(frist.gilt())
    }
}
