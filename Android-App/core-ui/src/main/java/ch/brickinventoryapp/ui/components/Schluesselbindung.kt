package ch.brickinventoryapp.ui.components

import ch.brickinventoryapp.model.step.Schluesselnonce
import ch.brickinventoryapp.model.step.Schrittantwort
import ch.brickinventoryapp.model.step.Schrittbindung
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.util.Base64

/** The Keystore part of the binding; Robolectric can't do attestation, tests inject it. */
interface AttestierbarerKey {
    /** A new key with [challenge] as the attestation challenge; its chain as DER, leaf first. */
    fun createWithAttestation(challenge: ByteArray): List<ByteArray>
}

/**
 * After signing in: fetch a nonce, generate the key with it, and deposit the chain.
 * The nonce makes the chain one-time-use; without it, another device's chain
 * could be resubmitted.
 */
class Schluesselbindung(
    private val bindung: Schrittbindung,
    private val schluessel: AttestierbarerKey,
    private val keystore: CoroutineDispatcher = Dispatchers.Default,
) {
    sealed interface Ausgang {
        data object Gebunden : Ausgang
        /** The device cannot generate a key with attestation. */
        data object WithoutAttestation : Ausgang
        data class Rejected(val meldung: String?) : Ausgang
    }

    suspend fun bind(): Ausgang {
        val nonce = when (val n = bindung.schluesselNonce()) {
            is Schluesselnonce.Nonce -> n.wert
            is Schluesselnonce.Rejected -> return Ausgang.Rejected(n.meldung)
        }
        val challenge = runCatching { Base64.getUrlDecoder().decode(nonce) }.getOrNull()
            ?: return Ausgang.Rejected(null)
        val kette = withContext(keystore) { runCatching { schluessel.createWithAttestation(challenge) }.getOrNull() }
        // Without attestation, the Keystore only supplies the key's self-signed certificate.
        if (kette == null || kette.size < 2) return Ausgang.WithoutAttestation
        return when (val r = bindung.depositChain(kette)) {
            Schrittantwort.Free -> Ausgang.Gebunden
            is Schrittantwort.Rejected -> Ausgang.Rejected(r.meldung)
            is Schrittantwort.Challenge, Schrittantwort.NotBound -> Ausgang.Rejected(null)
        }
    }
}
