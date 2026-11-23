package ch.brickinventoryapp.ui.components

import java.security.PublicKey
import java.security.Signature

/** What the app lock needs from the Keystore; the test provides a software key for it. */
internal interface UnlockKey {
    fun signature(): Signature
    fun public(): PublicKey
    fun discard()
}

/**
 * The app lock only lifts after a crypto operation: the signature released by the
 * prompt must sign a fresh random number matching the public key —
 * a hooked-up success callback without a real release fails at sign(). If it can't
 * sign (key invalid in the meantime), a new one is created and exactly one more follow-up question.
 */
internal class AppUnlocking(
    private val key: UnlockKey,
    private val question: (Signature, (Signature?) -> Unit) -> Unit,
) {
    private val approval = StepApproval(key::public)

    fun unlock(next: () -> Unit) = attempts(next, again = true)

    private fun attempts(next: () -> Unit, again: Boolean) {
        // Without a key, the app stays locked; the button on the lock screen asks again.
        val signature = runCatching { key.signature() }.getOrNull() ?: return
        question(signature) { released ->
            when {
                approval.applies(released) -> next()
                released != null && again -> {
                    runCatching { key.discard() }
                    attempts(next, again = false)
                }
            }
        }
    }
}
