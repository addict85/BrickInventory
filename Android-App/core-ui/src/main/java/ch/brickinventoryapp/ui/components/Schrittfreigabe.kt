package ch.brickinventoryapp.ui.components

import java.security.PublicKey
import java.security.SecureRandom
import java.security.Signature

/**
 * Was als Bestätigung zählt: eine Signatur, die zum öffentlichen Schlüssel des
 * Keystore-Schlüssels passt. Der Schlüssel signiert nur unmittelbar nach
 * Gerätesperre oder starker Biometrie; ein eingehakter onAuthenticationSucceeded
 * ohne echte Freigabe scheitert an sign().
 */
class Schrittfreigabe(
    private val oeffentlich: () -> PublicKey,
    private val random: SecureRandom = SecureRandom(),
) {
    fun gilt(released: Signature?): Boolean = signature(released, nonce()) != null

    fun nonce(): ByteArray = ByteArray(32).also(random::nextBytes)

    /** Die Signatur über [nachricht], wenn sie zum Schlüssel passt; sonst null. Je Freigabe nur einmal. */
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
