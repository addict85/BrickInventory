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
    private val zufall: SecureRandom = SecureRandom(),
) {
    fun gilt(freigegeben: Signature?): Boolean = unterschrift(freigegeben, nonce()) != null

    fun nonce(): ByteArray = ByteArray(32).also(zufall::nextBytes)

    /** Die Signatur über [nachricht], wenn sie zum Schlüssel passt; sonst null. Je Freigabe nur einmal. */
    fun unterschrift(freigegeben: Signature?, nachricht: ByteArray): ByteArray? {
        if (freigegeben == null) return null
        return runCatching {
            freigegeben.update(nachricht)
            val unterschrift = freigegeben.sign()
            val passt = Signature.getInstance(SIGNATURVERFAHREN).run {
                initVerify(oeffentlich())
                update(nachricht)
                verify(unterschrift)
            }
            unterschrift.takeIf { passt }
        }.getOrNull()
    }

    companion object {
        const val SIGNATURVERFAHREN = "SHA256withECDSA"
    }
}
