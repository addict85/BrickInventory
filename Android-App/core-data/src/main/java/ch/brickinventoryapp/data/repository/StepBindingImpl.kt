package ch.brickinventoryapp.data.repository

import ch.brickinventoryapp.data.api.DeviceApi
import ch.brickinventoryapp.contract.GeraeteSchluesselAnfrage
import ch.brickinventoryapp.model.step.KeyNonce
import ch.brickinventoryapp.model.step.StepAction
import ch.brickinventoryapp.model.step.StepResponse
import ch.brickinventoryapp.model.step.StepBinding
import ch.brickinventoryapp.contract.SchrittChallengeAnfrage
import ch.brickinventoryapp.contract.SchrittFreigabeAnfrage
import java.util.Base64
import javax.inject.Inject
import javax.inject.Singleton

/**
 * The step guard at the server. Every refusal, also a 404 or a network error, stops
 * the step: the server has known it for a long time, and a fallback to the check
 * on the device or to a key without attestation would be a path a third party
 * would only need to trigger.
 */
@Singleton
internal class StepBindingImpl @Inject constructor(
    private val api: DeviceApi,
) : StepBinding {

    override suspend fun challenge(action: StepAction): StepResponse {
        val identifier = action.identifier ?: return StepResponse.NotBound
        return when (val r = safeCall { api.stepChallenge(SchrittChallengeAnfrage(identifier)) }) {
            is Outcome.Success -> StepResponse.Challenge(r.data.challenge, r.data.nachricht)
            is Outcome.Failure -> StepResponse.Rejected(r.message.ifBlank { null })
        }
    }

    override suspend fun release(challenge: String, signature: ByteArray): StepResponse {
        val request = SchrittFreigabeAnfrage(challenge, Base64.getEncoder().encodeToString(signature))
        return when (val r = safeCall { api.stepRelease(request) }) {
            is Outcome.Success -> StepResponse.Free
            is Outcome.Failure -> StepResponse.Rejected(r.message.ifBlank { null })
        }
    }

    override suspend fun keyNonce(): KeyNonce = when (val r = safeCall { api.keyNonce() }) {
        is Outcome.Success -> KeyNonce.Nonce(r.data.nonce)
        is Outcome.Failure -> KeyNonce.Rejected(r.message.ifBlank { null })
    }

    /** The server's sentence only on its refusal: a network error after the sign-in is not worth a message. */
    override suspend fun depositChain(chain: List<ByteArray>): StepResponse {
        val request = GeraeteSchluesselAnfrage(kette = chain.map { Base64.getEncoder().encodeToString(it) })
        return when (val r = safeCall { api.depositChain(request) }) {
            is Outcome.Success -> StepResponse.Free
            is Outcome.Failure -> StepResponse.Rejected(if (r is Outcome.Failure.Server) r.message.ifBlank { null } else null)
        }
    }
}
