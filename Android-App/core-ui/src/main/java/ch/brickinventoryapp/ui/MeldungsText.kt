package ch.brickinventoryapp.ui

import androidx.compose.runtime.Composable
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import ch.brickinventoryapp.model.ui.Meldung

/**
 * Für Bildschirme: der Satz einer [Meldung] in der Sprache, die die Komposition
 * trägt. Ein Wert, der selbst eine Meldung ist, wird zuerst gebildet, damit ein Satz
 * einen anderen einbetten kann. Die Snackbar bildet ihren Satz ausserhalb der
 * Komposition (AppNavigation, über LanguageManager).
 */
@Composable
fun Meldung.satz(): String = when (this) {
    is Meldung.Text -> text
    is Meldung.Ressource ->
        if (werte.isEmpty()) stringResource(id) else stringResource(id, *werte.map { w -> if (w is Meldung) w.satz() else w }.toTypedArray())
    is Meldung.Menge -> pluralStringResource(id, anzahl, *werte.map { w -> if (w is Meldung) w.satz() else w }.toTypedArray())
}
