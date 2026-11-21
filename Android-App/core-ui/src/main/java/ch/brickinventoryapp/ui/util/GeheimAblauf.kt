package ch.brickinventoryapp.ui.util

/** How long a copied secret stays in the clipboard. */
internal const val SECRET_FLOW_MS = 60_000L

/** What happens to an expired secret in the clipboard. */
internal enum class SecretStep { WARTEN, LEEREN, FORGOTTEN }

/**
 * Only our own clip is cleared, recognized by its marker: if someone has
 * copied something else in the meantime, it belongs to them. If the clipboard
 * is not readable (from Android 10 in the background), it waits until the app
 * is back in front — clearing it blindly could hit someone else's content.
 */
internal fun secretStep(kennung: String?, dueAb: Long, jetzt: Long, lesbar: Boolean, idInClip: String?): SecretStep = when {
    kennung == null -> SecretStep.FORGOTTEN
    jetzt < dueAb || !lesbar -> SecretStep.WARTEN
    idInClip == kennung -> SecretStep.LEEREN
    else -> SecretStep.FORGOTTEN
}
