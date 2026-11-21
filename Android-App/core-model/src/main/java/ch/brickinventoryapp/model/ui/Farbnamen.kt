package ch.brickinventoryapp.model.ui

import ch.brickinventoryapp.model.domain.ColorView
import ch.brickinventoryapp.model.domain.OHNE_FARBE

/**
 * The color list without its entry for KEINE_FARBE („[No Color/Any Color]“):
 * the selection carries „no color“ itself, in the app's language; otherwise
 * the same choice would stand there twice.
 */
fun withoutNoColor(farben: List<ColorView>) =
    farben.filter { it.id != OHNE_FARBE }

/**
 * The name of today's color: KEINE_FARBE is called [noColor], never „Farbe
 * 9999“; otherwise the name from the list, then the saved one. Null if
 * none is known — then the display names the number.
 */
fun farbName(farben: List<ColorView>, aktuell: Int,
             aktuellerName: String?, noColor: String): String? =
    if (aktuell == OHNE_FARBE) noColor
    else farben.firstOrNull { it.id == aktuell }?.name ?: aktuellerName?.takeIf { it.isNotBlank() }
