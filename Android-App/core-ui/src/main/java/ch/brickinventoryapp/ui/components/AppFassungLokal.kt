package ch.brickinventoryapp.ui.components

import androidx.compose.runtime.Composable
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.res.stringResource
import ch.brickinventoryapp.model.util.AppVersion
import ch.brickinventoryapp.resources.R

/**
 * Die laufende Fassung für die Oberfläche; MainActivity setzt sie. Ohne Anbieter
 * (Vorschau, Bildschirmfoto) steht eine leere Fassung da statt eines Absturzes.
 */
val LocalAppVersion = staticCompositionLocalOf { AppVersion(name = "", code = 0) }

/** Der Name der laufenden Version für Sätze; ohne Namen „unbekannt“ statt „Installiert: “ mit nichts dahinter. */
@Composable
fun versionsName(): String = LocalAppVersion.current.name.ifBlank { stringResource(R.string.update_version_unbekannt) }
