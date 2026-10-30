package ch.brickinventoryapp.ui.theme

/**
 * Was gezeichnet wird: das Design des Servers, bei Bedarf in seiner dunklen
 * Fassung — oder mit [systemfarben] die Farben des Hintergrundbilds (Material You).
 */
data class Darstellung(val design: String, val dunkel: Boolean, val systemfarben: Boolean = false)

/** Ab Android 12 (API 31) liefert das System eigene Farbschemata. */
const val SYSTEMFARBEN_AB_SDK = 31

/**
 * Dunkel, wenn das Gerät „dunkel nach System“ will und das System dunkel ist —
 * dann die dunkle Fassung DESSELBEN Designs wie im Web (data-dunkel), nicht ein
 * anderes Design. Werkbank ist schon dunkel und bleibt, wie es ist. Systemfarben
 * haben immer eine dunkle Fassung; unter Android 12 gibt es sie nicht, dann gilt das Design.
 */
fun darstellung(
    design: String, dunkelNachSystem: Boolean, systemDunkel: Boolean,
    systemfarben: Boolean = false, sdk: Int = 0,
): Darstellung {
    val dynamisch = systemfarben && sdk >= SYSTEMFARBEN_AB_SDK
    val dunkel = dunkelNachSystem && systemDunkel && (dynamisch || hatDunkleFassung(design))
    return Darstellung(design, dunkel, dynamisch)
}

/**
 * Gilt „dunkel nach System"? Ohne gespeicherte Wahl ja — eine App, die nachts
 * hell bleibt, obwohl das Telefon dunkel ist, wirkt kaputt. Wer früher
 * ausdrücklich „Design des Servers" gewählt hat, behält das.
 */
fun dunkelNachSystemGilt(gespeichert: Boolean?): Boolean = gespeichert ?: true
