package ch.brickinventoryapp.ui.util

/** How long a copied secret stays in the clipboard. */
internal const val SECRET_FLOW_MS = 60_000L

/** What happens to an expired secret in the clipboard. */
internal enum class SecretStep { WAIT, CLEAR, FORGOTTEN }

/**
 * Only our own clip is cleared, recognized by its marker: if someone has
 * copied something else in the meantime, it belongs to them. If the clipboard
 * is not readable (from Android 10 in the background), it waits until the app
 * is back in front — clearing it blindly could hit someone else's content.
 */
internal fun secretStep(identifier: String?, dueFrom: Long, now: Long, readable: Boolean, idInClip: String?): SecretStep = when {
    identifier == null -> SecretStep.FORGOTTEN
    now < dueFrom || !readable -> SecretStep.WAIT
    idInClip == identifier -> SecretStep.CLEAR
    else -> SecretStep.FORGOTTEN
}
