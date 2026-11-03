package ch.brickinventoryapp

import ch.brickinventoryapp.ui.components.Bestaetigungsfrist
import ch.brickinventoryapp.ui.components.Schrittfreigabe
import ch.brickinventoryapp.ui.components.nachFreigabe
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.security.KeyPairGenerator
import java.security.Signature
import java.security.spec.ECGenParameterSpec

/**
 * Die Rückfrage per Gerätesperre ist an den Keystore gebunden (sec8 N3): Weiter geht
 * es nur mit einer Signatur, die zum öffentlichen Schlüssel passt. Der Keystore selbst
 * (Freigabe erst nach Sperre oder starker Biometrie) läuft nur auf dem Gerät; hier
 * steht ein gewöhnliches EC-Schlüsselpaar dafür, und „nicht freigegeben“ ist eine
 * Signatur, die nicht signieren kann oder mit einem anderen Schlüssel signiert.
 *
 * Gegenproben (03.11.2026, gemessen mit kotlinc lokal):
 *   A  Schrittfreigabe.gilt() nimmt jede vorhandene Signatur → rot „ein anderer Schluessel
 *      zaehlt nicht“ und „eine Signatur ohne Freigabe zaehlt nicht“;
 *      gegenproben/schrittschutz-ohne-signatur.patch
 *   B  nachFreigabe() ohne die Prüfung (`frist.bestaetigt(); weiter()`) → rot „ein
 *      Rueckruf ohne CryptoObject laesst nicht weiter“
 */
class SchrittfreigabeTest {

    private fun paar() = KeyPairGenerator.getInstance("EC").apply { initialize(ECGenParameterSpec("secp256r1")) }.generateKeyPair()

    private val geraet = paar()
    private val freigabe = Schrittfreigabe({ geraet.public })

    private fun signatur(mit: java.security.PrivateKey) =
        Signature.getInstance(Schrittfreigabe.SIGNATURVERFAHREN).apply { initSign(mit) }

    @Test
    fun `die vom Schluessel freigegebene Signatur zaehlt`() {
        assertTrue(freigabe.gilt(signatur(geraet.private)))
    }

    @Test
    fun `ein anderer Schluessel zaehlt nicht`() {
        assertFalse(freigabe.gilt(signatur(paar().private)))
    }

    @Test
    fun `eine Signatur ohne Freigabe zaehlt nicht`() {
        // Wie ein Keystore-Schlüssel vor der Freigabe: sign() wirft.
        assertFalse(freigabe.gilt(Signature.getInstance(Schrittfreigabe.SIGNATURVERFAHREN)))
        assertFalse(freigabe.gilt(null))
    }

    @Test
    fun `ein Rueckruf ohne CryptoObject laesst nicht weiter`() {
        val frist = Bestaetigungsfrist(uhr = { 0L })
        var weiter = 0
        nachFreigabe(freigabe, null, frist) { weiter++ }
        assertTrue("Ohne Freigabe weder weiter …", weiter == 0)
        assertFalse("… noch eine Frist für die nächsten Schritte", frist.gilt())
        nachFreigabe(freigabe, signatur(geraet.private), frist) { weiter++ }
        assertTrue(weiter == 1)
        assertTrue(frist.gilt())
    }
}
