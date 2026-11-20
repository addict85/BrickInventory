package ch.brickinventoryapp.model.ui.theme

/**
 * Gilt „dunkel nach System"? Ohne gespeicherte Wahl ja — eine App, die nachts
 * hell bleibt, obwohl das Telefon dunkel ist, wirkt kaputt. Wer früher
 * ausdrücklich „Design des Servers" gewählt hat, behält das.
 */

fun darkAfterSystemApplies(gespeichert: Boolean?): Boolean = gespeichert ?: true

/** Hell, dunkel oder wie das System — je Gerät, in den Einstellungen unter „Darstellung“. */
object Helligkeit {
    const val SYSTEM = "system"
    const val LIGHT = "hell"
    const val DARK = "dunkel"
}

/**
 * Die wirksame Wahl: die gespeicherte, sonst die frühere Ja/Nein-Wahl „dunkel
 * nach System“ (ja → System, nein → Hell), damit niemand nach dem Update anders sieht.
 */
fun brightnessApplies(gespeichert: String?, earlierAfterSystem: Boolean?): String =
    gespeichert?.takeIf { it == Helligkeit.SYSTEM || it == Helligkeit.LIGHT || it == Helligkeit.DARK }
        ?: if (darkAfterSystemApplies(earlierAfterSystem)) Helligkeit.SYSTEM else Helligkeit.LIGHT
