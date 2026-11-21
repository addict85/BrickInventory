package ch.brickinventoryapp.ui.components

import ch.brickinventoryapp.model.step.Schrittaktion
import ch.brickinventoryapp.model.step.Schrittantwort
import ch.brickinventoryapp.model.step.Schrittbindung
import java.security.Signature

/**
 * A confirmation from the challenge to the release on the server, without Android:
 * first the server asks, then the screen lock ([entsperren] supplies the signature
 * released by the Keystore), and finally the server checks the signature. It
 * only proceeds if both sides agreed.
 */
class Schrittablauf(private val bindung: Schrittbindung, private val freigabe: Schrittfreigabe) {

    sealed interface Ausgang {
        data object Weiter : Ausgang
        /** The lock was cancelled or didn't produce a valid signature. */
        data object Abgebrochen : Ausgang
        data class Rejected(val meldung: String?) : Ausgang
    }

    suspend fun confirm(aktion: Schrittaktion, entsperren: suspend () -> Signature?): Ausgang {
        val c = bindung.challenge(aktion)
        val nachricht = when (c) {
            is Schrittantwort.Challenge -> c.nachricht.toByteArray(Charsets.UTF_8)
            is Schrittantwort.Rejected -> return Ausgang.Rejected(c.meldung)
            Schrittantwort.Free -> return Ausgang.Rejected(null)
            // Without a binding on the server, the check stays on the device: a fresh nonce.
            Schrittantwort.NotBound -> freigabe.nonce()
        }
        val signature = freigabe.signature(entsperren(), nachricht) ?: return Ausgang.Abgebrochen
        if (c !is Schrittantwort.Challenge) return Ausgang.Weiter
        return when (val f = bindung.freigeben(c.challenge, signature)) {
            Schrittantwort.Free -> Ausgang.Weiter
            is Schrittantwort.Rejected -> Ausgang.Rejected(f.meldung)
            is Schrittantwort.Challenge, Schrittantwort.NotBound -> Ausgang.Rejected(null)
        }
    }
}
