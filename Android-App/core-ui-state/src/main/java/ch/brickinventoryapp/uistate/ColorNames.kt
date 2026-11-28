package ch.brickinventoryapp.uistate

import ch.brickinventoryapp.model.domain.ColorView
import ch.brickinventoryapp.model.domain.WITHOUT_COLOR

/**
 * The color list without its entry for NO_COLOR („[No Color/Any Color]“):
 * the selection carries „no color“ itself, in the app's language; otherwise
 * the same choice would stand there twice.
 */
fun withoutNoColor(colors: List<ColorView>) =
    colors.filter { it.id != WITHOUT_COLOR }

/**
 * The name of today's color: NO_COLOR is called [noColor], never „Farbe
 * 9999“; otherwise the name from the list, then the saved one. Null if
 * none is known — then the display names the number.
 */
fun colorName(colors: List<ColorView>, current: Int,
             currentName: String?, noColor: String): String? =
    if (current == WITHOUT_COLOR) noColor
    else colors.firstOrNull { it.id == current }?.name ?: currentName?.takeIf { it.isNotBlank() }
