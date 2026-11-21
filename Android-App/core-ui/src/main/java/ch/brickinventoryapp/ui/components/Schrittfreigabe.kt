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
class Schrittfreigabe(
    private val oeffentlich: () -> PublicKey,
    private val random: SecureRandom = SecureRandom(),
) {
    fun gilt(released: Signature?): Boolean = signature(released, nonce()) != null

    fun nonce(): ByteArray = ByteArray(32).also(random::nextBytes)

    /** The signature over [nachricht], if it matches the key; otherwise null. Only once per release. */
    fun signature(released: Signature?, nachricht: ByteArray): ByteArray? {
        if (released == null) return null
        return runCatching {
            released.update(nachricht)
            val signature = released.sign()
            val passt = Signature.getInstance(SIGNATURVERFAHREN).run {
                initVerify(oeffentlich())
                update(nachricht)
                verify(signature)
            }
            signature.takeIf { passt }
        }.getOrNull()
    }

    companion object {
        const val SIGNATURVERFAHREN = "SHA256withECDSA"
    }
}
