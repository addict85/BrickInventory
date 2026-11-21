package ch.brickinventoryapp.ui.components

import java.security.PublicKey
import java.security.Signature

/** What the app lock needs from the Keystore; the test provides a software key for it. */
internal interface Entsperrschluessel {
    fun signatur(): Signature
    fun oeffentlich(): PublicKey
    fun discard()
}

/**
 * The app lock only lifts after a crypto operation: the signature released by the
 * prompt must sign a fresh random number matching the public key —
 * a hooked-up success callback without a real release fails at sign(). If it can't
 * sign (key invalid in the meantime), a new one is created and exactly one more follow-up question.
 */
internal class AppUnlocking(
    private val schluessel: Entsperrschluessel,
    private val frage: (Signature, (Signature?) -> Unit) -> Unit,
) {
    private val freigabe = Schrittfreigabe(schluessel::oeffentlich)

    fun unlock(weiter: () -> Unit) = versuche(weiter, again = true)

    private fun versuche(weiter: () -> Unit, again: Boolean) {
        // Without a key, the app stays locked; the button on the lock screen asks again.
        val signatur = runCatching { schluessel.signatur() }.getOrNull() ?: return
        frage(signatur) { released ->
            when {
                freigabe.gilt(released) -> weiter()
                released != null && again -> {
                    runCatching { schluessel.discard() }
                    versuche(weiter, again = false)
                }
            }
        }
    }
}
