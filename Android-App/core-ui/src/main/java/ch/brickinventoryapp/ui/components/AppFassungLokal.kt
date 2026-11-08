package ch.brickinventoryapp.ui.components

import androidx.compose.runtime.staticCompositionLocalOf
import ch.brickinventoryapp.model.util.AppFassung

/**
 * Die laufende Fassung für die Oberfläche; MainActivity setzt sie. Ohne Anbieter
 * (Vorschau, Bildschirmfoto) steht eine leere Fassung da statt eines Absturzes.
 */
val LocalAppFassung = staticCompositionLocalOf { AppFassung(name = "", code = 0) }
