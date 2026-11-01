package ch.brickinventoryapp.ui.theme



/**
 * Gilt „dunkel nach System"? Ohne gespeicherte Wahl ja — eine App, die nachts
 * hell bleibt, obwohl das Telefon dunkel ist, wirkt kaputt. Wer früher
 * ausdrücklich „Design des Servers" gewählt hat, behält das.
 */
fun dunkelNachSystemGilt(gespeichert: Boolean?): Boolean = gespeichert ?: true

/** Hell, dunkel oder wie das System — je Gerät, in den Einstellungen unter „Darstellung“. */
object Helligkeit {
    const val SYSTEM = "system"
    const val HELL = "hell"
    const val DUNKEL = "dunkel"
}

/**
 * Die wirksame Wahl: die gespeicherte, sonst die frühere Ja/Nein-Wahl „dunkel
 * nach System“ (ja → System, nein → Hell), damit niemand nach dem Update anders sieht.
 */
fun helligkeitGilt(gespeichert: String?, frueherNachSystem: Boolean?): String =
    gespeichert?.takeIf { it == Helligkeit.SYSTEM || it == Helligkeit.HELL || it == Helligkeit.DUNKEL }
        ?: if (dunkelNachSystemGilt(frueherNachSystem)) Helligkeit.SYSTEM else Helligkeit.HELL
