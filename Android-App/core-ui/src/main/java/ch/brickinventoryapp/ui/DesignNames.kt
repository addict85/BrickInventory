package ch.brickinventoryapp.ui

import ch.brickinventoryapp.model.ui.theme.Design
import ch.brickinventoryapp.resources.R

/** The name of a theme; exhaustive, so a new theme stands out here. */
fun Design.title(): Int = when (this) {
    Design.CLASSIC -> R.string.monitoring_theme_classic
    Design.BRICK -> R.string.monitoring_theme_brick
    Design.WORKBENCH -> R.string.monitoring_theme_workbench
    Design.COLOR_FAN -> R.string.monitoring_theme_color_fan
    Design.STUD -> R.string.monitoring_theme_stud
    Design.GLOSSY -> R.string.monitoring_theme_glossy
}

/** One sentence per theme for the chooser: Werkbank and the dark Classic look alike. */
fun Design.description(): Int = when (this) {
    Design.CLASSIC -> R.string.design_text_classic
    Design.BRICK -> R.string.design_text_brick
    Design.WORKBENCH -> R.string.design_text_workbench
    Design.COLOR_FAN -> R.string.design_text_color_fan
    Design.STUD -> R.string.design_text_stud
    Design.GLOSSY -> R.string.design_text_glossy
}
