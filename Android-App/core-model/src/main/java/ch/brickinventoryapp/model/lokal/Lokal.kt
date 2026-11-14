package ch.brickinventoryapp.model.lokal

/**
 * Was lokal liegt; [stand] ist der Zeitpunkt der letzten Serverantwort, null = nie geladen.
 * [verworfen] zählt Zeilen, die sich nicht mehr lesen liessen — sie fehlen in [liste].
 */
data class Lokal<T>(val liste: List<T>, val stand: Long?, val verworfen: Int = 0)

/**
 * Die Fächer, die die App lokal führt: Listen und einzelne Antworten (Kennzahlen,
 * Katalog-Metadaten). Der Name steht in der Datenbank — nicht umbenennen.
 */
enum class Bestandsart {
    SETS, MERKLISTE, TEILE, FIGUREN, MANUELLE_TEILE, MANUELLE_FIGUREN, GUTSCHEINE, PREISALARME, LAGERORTE,
    KENNZAHLEN, KATALOG_META,
}
