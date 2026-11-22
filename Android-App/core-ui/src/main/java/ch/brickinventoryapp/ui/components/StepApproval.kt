package ch.brickinventoryapp.ui.components

import java.security.PublicKey
import java.security.SecureRandom
import java.security.Signature

/**
 * What counts as a confirmation: a signature that matches the public key of the
 * Keystore key. The key only signs immediately after the
 * screen lock or strong biometrics; a hooked-up onAuthenticationSucceeded
 * without a real release fails at sign().
 */
class StepApproval(
    private val public: () -> PublicKey,
    private val random: SecureRandom = SecureRandom(),
) {
    fun applies(released: Signature?): Boolean = signature(released, nonce()) != null

    fun nonce(): ByteArray = ByteArray(32).also(random::nextBytes)

    /** The signature over [message], if it matches the key; otherwise null. Only once per release. */
    fun signature(released: Signature?, message: ByteArray): ByteArray? {
        if (released == null) return null
        return runCatching {
            released.update(message)
            val signature = released.sign()
            val matches = Signature.getInstance(SIGNATURE_SCHEME).run {
                initVerify(public())
                update(message)
                verify(signature)
            }
            signature.takeIf { matches }
        }.getOrNull()
    }

    companion object {
        const val SIGNATURE_SCHEME = "SHA256withECDSA"
    }
}
