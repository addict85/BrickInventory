package ch.brickinventoryapp.ui.theme

import ch.brickinventoryapp.model.ui.theme.Design
import ch.brickinventoryapp.model.ui.theme.Helligkeit

/**
 * Was gezeichnet wird: das Design des Servers, bei Bedarf in seiner dunklen
 * Fassung — oder mit [systemfarben] die Farben des Hintergrundbilds (Material You).
 */
data class Darstellung(val design: Design, val dunkel: Boolean, val systemfarben: Boolean = false)

/** Ab Android 12 (API 31) liefert das System eigene Farbschemata. */
const val SYSTEMFARBEN_AB_SDK = 31

/**
 * [helligkeit] (Helligkeit.SYSTEM/HELL/DUNKEL) entscheidet, ob die dunkle Fassung
 * DESSELBEN Designs gilt wie im Web (data-dunkel), nicht ein anderes Design.
 * Werkbank ist schon dunkel und bleibt, wie es ist. Systemfarben haben immer eine
 * dunkle Fassung; unter Android 12 gibt es sie nicht, dann gilt das Design.
 */
fun darstellung(
    design: Design, helligkeit: String, systemDunkel: Boolean,
    systemfarben: Boolean = false, sdk: Int = 0,
): Darstellung {
    val dynamisch = systemfarben && sdk >= SYSTEMFARBEN_AB_SDK
    val gewuenscht = when (helligkeit) {
        Helligkeit.DUNKEL -> true
        Helligkeit.HELL -> false
        else -> systemDunkel
    }
    return Darstellung(design, gewuenscht && helligkeitWaehlbar(design, systemfarben, sdk), dynamisch)
}

/**
 * Wirkt die Wahl Hell/Dunkel bei diesem Design? Nicht bei einem Design ohne dunkle
 * Fassung (Werkbank ist schon dunkel) — die Einstellungen schalten die Wahl dann ab,
 * statt einen Schalter ohne Wirkung anzubieten.
 */
fun helligkeitWaehlbar(design: Design, systemfarben: Boolean = false, sdk: Int = 0): Boolean =
    (systemfarben && sdk >= SYSTEMFARBEN_AB_SDK) || hatDunkleFassung(design)
