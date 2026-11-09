package ch.brickinventoryapp.ui

import ch.brickinventoryapp.ui.components.AppEntsperrung
import ch.brickinventoryapp.ui.components.Entsperrschluessel
import ch.brickinventoryapp.ui.components.Schrittfreigabe
import org.junit.Assert.assertEquals
import org.junit.Test
import java.security.KeyPairGenerator
import java.security.PrivateKey
import java.security.Signature
import java.security.spec.ECGenParameterSpec

/**
 * Die App-Sperre fällt nur mit einer Signatur des eigenen Schlüssels, nicht mit dem
 * Erfolgsrückruf allein; ein ungültig gewordener Schlüssel wird ersetzt und es wird
 * genau einmal nachgefragt. Der Keystore steht hier als Software-EC-Schlüssel, und
 * „nicht freigegeben“ ist eine Signatur, die nicht signieren kann oder fremd signiert.
 *
 * Gegenproben (09.11.2026 lokal mit kotlinc gemessen):
 *   A  jede vorhandene Signatur entsperrt, ohne zu signieren → rot „fremd signiert …“ und
 *      „ungueltiger Schluessel …“; gegenproben/app-sperre-ohne-krypto.patch
 *   B  kein neuer Schlüssel nach gescheiterter Signatur → rot „ungueltiger Schluessel …“;
 *      gegenproben/app-sperre-ohne-neuen-schluessel.patch
 *   C  nachfragen ohne Ende → rot „fremd signiert …“ (dritte Rückfrage);
 *      gegenproben/app-sperre-fragt-ohne-ende.patch
 */
class AppEntsperrungTest {

    private fun paar() = KeyPairGenerator.getInstance("EC").apply { initialize(ECGenParameterSpec("secp256r1")) }.generateKeyPair()

    private fun signatur(mit: PrivateKey) =
        Signature.getInstance(Schrittfreigabe.SIGNATURVERFAHREN).apply { initSign(mit) }

    private inner class Schluessel : Entsperrschluessel {
        var paar = paar()
        var verworfen = 0
        var fehlt = false
        override fun signatur() = if (fehlt) error("kein Keystore") else signatur(paar.private)
        override fun oeffentlich() = paar.public
        override fun verwerfe() { verworfen++; paar = paar() }
    }

    private val schluessel = Schluessel()
    private var entsperrt = 0

    /** Beantwortet jede Rückfrage mit der nächsten Antwort; danach wie ein Abbruch. */
    private fun lauf(vararg antworten: (Signature) -> Signature?): Int {
        var fragen = 0
        AppEntsperrung(schluessel) { s, antwort -> antworten.getOrNull(fragen++)?.let { antwort(it(s)) } ?: antwort(null) }
            .entsperre { entsperrt++ }
        return fragen
    }

    @Test
    fun `die freigegebene Signatur entsperrt`() {
        assertEquals(1, lauf({ it }))
        assertEquals(1, entsperrt)
    }

    @Test
    fun `Erfolg ohne Signatur entsperrt nicht und fragt nicht nach`() {
        assertEquals(1, lauf({ null }))
        assertEquals(0, entsperrt)
        assertEquals(0, schluessel.verworfen)
    }

    @Test
    fun `fremd signiert entsperrt nicht und fragt nur einmal nach`() {
        val fremd = paar()
        assertEquals(2, lauf({ signatur(fremd.private) }, { signatur(fremd.private) }, { signatur(fremd.private) }))
        assertEquals(0, entsperrt)
    }

    @Test
    fun `ungueltiger Schluessel wird ersetzt und einmal nachgefragt`() {
        // Eine Signatur zum Prüfen statt zum Signieren scheitert an sign() wie ein ungültig gewordener Schlüssel.
        val kannNicht: (Signature) -> Signature? = {
            Signature.getInstance(Schrittfreigabe.SIGNATURVERFAHREN).apply { initVerify(schluessel.paar.public) }
        }
        assertEquals(2, lauf(kannNicht, { it }))
        assertEquals(1, schluessel.verworfen)
        assertEquals(1, entsperrt)
    }

    @Test
    fun `ohne Schluessel bleibt die App gesperrt`() {
        schluessel.fehlt = true
        assertEquals(0, lauf({ it }))
        assertEquals(0, entsperrt)
    }
}
