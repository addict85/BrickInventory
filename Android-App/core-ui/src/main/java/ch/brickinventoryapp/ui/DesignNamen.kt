package ch.brickinventoryapp.ui

import ch.brickinventoryapp.model.data.model.*
import ch.brickinventoryapp.ressourcen.R

/** Die Designs mit ihrem Namen — dieselbe Liste wie ERLAUBTE_DESIGNS und DESIGNS auf dem Server. */
val DESIGN_NAMEN: List<Pair<String, Int>> = listOf(
    "classic" to R.string.monitoring_theme_classic,
    "brick" to R.string.monitoring_theme_brick,
    "werkbank" to R.string.monitoring_theme_werkbank,
    "farbfaecher" to R.string.monitoring_theme_farbfaecher,
    "noppe" to R.string.monitoring_theme_noppe,
    "hochglanz" to R.string.monitoring_theme_hochglanz,
)

/** Ein Satz je Design für den Wähler: Werkbank und das dunkle Classic sehen sich ähnlich. */
val DESIGN_TEXTE: Map<String, Int> = mapOf(
    "classic" to R.string.design_text_classic,
    "brick" to R.string.design_text_brick,
    "werkbank" to R.string.design_text_werkbank,
    "farbfaecher" to R.string.design_text_farbfaecher,
    "noppe" to R.string.design_text_noppe,
    "hochglanz" to R.string.design_text_hochglanz,
)
