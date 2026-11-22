package ch.brickinventoryapp.ui.components

import ch.brickinventoryapp.model.step.StepAction
import ch.brickinventoryapp.model.step.StepBinding
import ch.brickinventoryapp.model.step.StepResponse
import java.security.Signature

/**
 * A confirmation from the challenge to the release on the server, without Android:
 * first the server asks, then the screen lock ([unlock] supplies the signature
 * released by the Keystore), and finally the server checks the signature. It
 * only proceeds if both sides agreed.
 */
class StepFlow(private val binding: StepBinding, private val approval: StepApproval) {

    sealed interface Outbox {
        data object Next : Outbox
        /** The lock was cancelled or didn't produce a valid signature. */
        data object Cancelled : Outbox
        data class Rejected(val message: String?) : Outbox
    }

    suspend fun confirm(action: StepAction, unlock: suspend () -> Signature?): Outbox {
        val c = binding.challenge(action)
        val message = when (c) {
            is StepResponse.Challenge -> c.message.toByteArray(Charsets.UTF_8)
            is StepResponse.Rejected -> return Outbox.Rejected(c.message)
            StepResponse.Free -> return Outbox.Rejected(null)
            // Without a binding on the server, the check stays on the device: a fresh nonce.
            StepResponse.NotBound -> approval.nonce()
        }
        val signature = approval.signature(unlock(), message) ?: return Outbox.Cancelled
        if (c !is StepResponse.Challenge) return Outbox.Next
        return when (val f = binding.release(c.challenge, signature)) {
            StepResponse.Free -> Outbox.Next
            is StepResponse.Rejected -> Outbox.Rejected(f.message)
            is StepResponse.Challenge, StepResponse.NotBound -> Outbox.Rejected(null)
        }
    }
}
