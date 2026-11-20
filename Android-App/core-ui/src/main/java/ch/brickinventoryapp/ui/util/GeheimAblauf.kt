package ch.brickinventoryapp.ui.util

/** So lange bleibt ein kopiertes Geheimnis in der Zwischenablage. */
internal const val SECRET_FLOW_MS = 60_000L

/** Was mit einem abgelaufenen Geheimnis in der Zwischenablage geschieht. */
internal enum class SecretStep { WARTEN, LEEREN, FORGOTTEN }

/**
 * Geleert wird nur unser eigener Clip, erkannt an seiner Kennung: Hat jemand
 * inzwischen etwas anderes kopiert, gehört es ihm. Ist die Ablage nicht lesbar
 * (ab Android 10 im Hintergrund), wird gewartet, bis die App wieder vorne ist —
 * blind zu leeren könnte fremden Inhalt treffen.
 */
internal fun secretStep(kennung: String?, dueAb: Long, jetzt: Long, lesbar: Boolean, idInClip: String?): SecretStep = when {
    kennung == null -> SecretStep.FORGOTTEN
    jetzt < dueAb || !lesbar -> SecretStep.WARTEN
    idInClip == kennung -> SecretStep.LEEREN
    else -> SecretStep.FORGOTTEN
}
