package ch.brickinventoryapp.model.step

/** [identifier] is the server's action; without it the check stays on the device (before sign-in). */

enum class StepAction(val identifier: String?) {
    VOUCHER("gutschein"),
    ADMIN("verwaltung"),
    SECOND_FACTOR("zweiter_faktor"),
    LOCAL(null),
}

/** What the server says about a step; [Rejected.message] null means: no response. */
sealed interface StepResponse {
    data class Challenge(val challenge: String, val message: String) : StepResponse
    data object Free : StepResponse
    /** A step without action at the server ([StepAction.LOCAL]): the check stays on the device. */
    data object NotBound : StepResponse
    data class Rejected(val message: String?) : StepResponse
}

/** The nonce the keystore key carries as attestation challenge ([Nonce.value]: Base64url). */
sealed interface KeyNonce {
    data class Nonce(val value: String) : KeyNonce
    data class Rejected(val message: String?) : KeyNonce
}

/** The path to the server; core-data implements it, core-ui asks it before every step. */
interface StepBinding {
    /** [StepResponse.Challenge], [StepResponse.NotBound] or [StepResponse.Rejected]. */
    suspend fun challenge(action: StepAction): StepResponse
    /** [StepResponse.Free] or [StepResponse.Rejected]. */
    suspend fun release(challenge: String, signature: ByteArray): StepResponse
    /**
     * Only right after sign-in. There is no path without nonce: the server accepts
     * no bare key, a fallback to it could only be forced.
     */
    suspend fun keyNonce(): KeyNonce = KeyNonce.Rejected(null)

    /** The attestation chain (DER per certificate, leaf first): [StepResponse.Free] or [StepResponse.Rejected]. */
    suspend fun depositChain(chain: List<ByteArray>): StepResponse = StepResponse.Rejected(null)

    companion object {
        /** Without server, for tests and activities without account. */
        val WITHOUT: StepBinding = object : StepBinding {
            override suspend fun challenge(action: StepAction) = StepResponse.NotBound
            override suspend fun release(challenge: String, signature: ByteArray) = StepResponse.Free
        }
    }
}
