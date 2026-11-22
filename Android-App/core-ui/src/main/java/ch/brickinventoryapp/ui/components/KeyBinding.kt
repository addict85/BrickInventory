package ch.brickinventoryapp.ui.components

import ch.brickinventoryapp.model.step.KeyNonce
import ch.brickinventoryapp.model.step.StepResponse
import ch.brickinventoryapp.model.step.StepBinding
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.util.Base64

/** The Keystore part of the binding; Robolectric can't do attestation, tests inject it. */
interface AttestableKey {
    /** A new key with [challenge] as the attestation challenge; its chain as DER, leaf first. */
    fun createWithAttestation(challenge: ByteArray): List<ByteArray>
}

/**
 * After signing in: fetch a nonce, generate the key with it, and deposit the chain.
 * The nonce makes the chain one-time-use; without it, another device's chain
 * could be resubmitted.
 */
class KeyBinding(
    private val binding: StepBinding,
    private val key: AttestableKey,
    private val keystore: CoroutineDispatcher = Dispatchers.Default,
) {
    sealed interface Outbox {
        data object Bound : Outbox
        /** The device cannot generate a key with attestation. */
        data object WithoutAttestation : Outbox
        data class Rejected(val message: String?) : Outbox
    }

    suspend fun bind(): Outbox {
        val nonce = when (val n = binding.keyNonce()) {
            is KeyNonce.Nonce -> n.value
            is KeyNonce.Rejected -> return Outbox.Rejected(n.message)
        }
        val challenge = runCatching { Base64.getUrlDecoder().decode(nonce) }.getOrNull()
            ?: return Outbox.Rejected(null)
        val chain = withContext(keystore) { runCatching { key.createWithAttestation(challenge) }.getOrNull() }
        // Without attestation, the Keystore only supplies the key's self-signed certificate.
        if (chain == null || chain.size < 2) return Outbox.WithoutAttestation
        return when (val r = binding.depositChain(chain)) {
            StepResponse.Free -> Outbox.Bound
            is StepResponse.Rejected -> Outbox.Rejected(r.message)
            is StepResponse.Challenge, StepResponse.NotBound -> Outbox.Rejected(null)
        }
    }
}
