package ch.brickinventoryapp.ui

import ch.brickinventoryapp.model.ui.theme.Design
import ch.brickinventoryapp.resources.R

/** The name of a theme; exhaustive, so a new theme stands out here. */
fun Design.titel(): Int = when (this) {
    Design.CLASSIC -> R.string.monitoring_theme_classic
    Design.BRICK -> R.string.monitoring_theme_brick
    Design.WERKBANK -> R.string.monitoring_theme_werkbank
    Design.FARBFAECHER -> R.string.monitoring_theme_farbfaecher
    Design.NOPPE -> R.string.monitoring_theme_noppe
    Design.HOCHGLANZ -> R.string.monitoring_theme_hochglanz
}

/** One sentence per theme for the chooser: Werkbank and the dark Classic look alike. */
fun Design.beschreibung(): Int = when (this) {
    Design.CLASSIC -> R.string.design_text_classic
    Design.BRICK -> R.string.design_text_brick
    Design.WERKBANK -> R.string.design_text_werkbank
    Design.FARBFAECHER -> R.string.design_text_farbfaecher
    Design.NOPPE -> R.string.design_text_noppe
    Design.HOCHGLANZ -> R.string.design_text_hochglanz
}
