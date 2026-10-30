package ch.brickinventoryapp.ui.theme

/** Was gezeichnet wird: das Design des Servers, bei Bedarf in seiner dunklen Fassung. */
data class Darstellung(val design: String, val dunkel: Boolean)

/**
 * Dunkel, wenn das Gerät „dunkel nach System“ will und das System dunkel ist —
 * dann die dunkle Fassung DESSELBEN Designs wie im Web (data-dunkel), nicht ein
 * anderes Design. Werkbank ist schon dunkel und bleibt, wie es ist.
 */
fun darstellung(design: String, dunkelNachSystem: Boolean, systemDunkel: Boolean): Darstellung =
    Darstellung(design, dunkel = dunkelNachSystem && systemDunkel && hatDunkleFassung(design))

/**
 * Gilt „dunkel nach System"? Ohne gespeicherte Wahl ja — eine App, die nachts
 * hell bleibt, obwohl das Telefon dunkel ist, wirkt kaputt. Wer früher
 * ausdrücklich „Design des Servers" gewählt hat, behält das.
 */
fun dunkelNachSystemGilt(gespeichert: Boolean?): Boolean = gespeichert ?: true
