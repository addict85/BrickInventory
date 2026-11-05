package ch.brickinventoryapp.util

/** So lange bleibt ein kopiertes Geheimnis in der Zwischenablage. */
internal const val GEHEIM_ABLAUF_MS = 60_000L

/** Was mit einem abgelaufenen Geheimnis in der Zwischenablage geschieht. */
enum class GeheimSchritt { WARTEN, LEEREN, VERGESSEN }

/**
 * Geleert wird nur unser eigener Clip, erkannt an seiner Kennung: Hat jemand
 * inzwischen etwas anderes kopiert, gehört es ihm. Ist die Ablage nicht lesbar
 * (ab Android 10 im Hintergrund), wird gewartet, bis die App wieder vorne ist —
 * blind zu leeren könnte fremden Inhalt treffen.
 */
internal fun geheimSchritt(kennung: String?, faelligAb: Long, jetzt: Long, lesbar: Boolean, kennungImClip: String?): GeheimSchritt = when {
    kennung == null -> GeheimSchritt.VERGESSEN
    jetzt < faelligAb || !lesbar -> GeheimSchritt.WARTEN
    kennungImClip == kennung -> GeheimSchritt.LEEREN
    else -> GeheimSchritt.VERGESSEN
}
