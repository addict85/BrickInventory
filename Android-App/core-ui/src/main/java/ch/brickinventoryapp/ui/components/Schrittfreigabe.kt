package ch.brickinventoryapp.ui.components

import java.security.PublicKey
import java.security.SecureRandom
import java.security.Signature

/**
 * Was als Bestätigung zählt: eine Signatur über eine frische Nonce, die zum
 * öffentlichen Schlüssel des Keystore-Schlüssels passt. Der Schlüssel signiert nur
 * unmittelbar nach Gerätesperre oder starker Biometrie; ein eingehakter
 * onAuthenticationSucceeded ohne echte Freigabe scheitert an sign().
 */
class Schrittfreigabe(
    private val oeffentlich: () -> PublicKey,
    private val zufall: SecureRandom = SecureRandom(),
) {
    fun gilt(freigegeben: Signature?): Boolean {
        if (freigegeben == null) return false
        val nonce = ByteArray(32).also(zufall::nextBytes)
        return runCatching {
            freigegeben.update(nonce)
            val unterschrift = freigegeben.sign()
            Signature.getInstance(SIGNATURVERFAHREN).run {
                initVerify(oeffentlich())
                update(nonce)
                verify(unterschrift)
            }
        }.getOrDefault(false)
    }

    companion object {
        const val SIGNATURVERFAHREN = "SHA256withECDSA"
    }
}

/** Weiter nur mit einer Signatur, die der Keystore für diese Rückfrage freigegeben hat. */
internal fun nachFreigabe(freigabe: Schrittfreigabe, signatur: Signature?, frist: Bestaetigungsfrist, weiter: () -> Unit) {
    if (!freigabe.gilt(signatur)) return
    frist.bestaetigt()
    weiter()
}
