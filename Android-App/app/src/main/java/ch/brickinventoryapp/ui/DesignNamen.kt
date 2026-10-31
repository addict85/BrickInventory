package ch.brickinventoryapp.ui

import ch.brickinventoryapp.data.model.*

/** Die Designs mit ihrem Namen — dieselbe Liste wie ERLAUBTE_DESIGNS und DESIGNS auf dem Server. */
val DESIGN_NAMEN: List<Pair<String, Int>> = listOf(
    "classic" to ch.brickinventoryapp.R.string.monitoring_theme_classic,
    "brick" to ch.brickinventoryapp.R.string.monitoring_theme_brick,
    "werkbank" to ch.brickinventoryapp.R.string.monitoring_theme_werkbank,
    "farbfaecher" to ch.brickinventoryapp.R.string.monitoring_theme_farbfaecher,
    "noppe" to ch.brickinventoryapp.R.string.monitoring_theme_noppe,
    "hochglanz" to ch.brickinventoryapp.R.string.monitoring_theme_hochglanz,
)
