package ch.brickinventoryapp.model.lokal

/** Was lokal liegt; [stand] ist der Zeitpunkt der letzten Serverantwort, null = nie geladen. */
data class Lokal<T>(val liste: List<T>, val stand: Long?)

/** Die Listen, die die App lokal führt. Der Name steht in der Datenbank — nicht umbenennen. */
enum class Bestandsart { SETS, MERKLISTE, TEILE, FIGUREN, MANUELLE_TEILE, MANUELLE_FIGUREN, GUTSCHEINE }
