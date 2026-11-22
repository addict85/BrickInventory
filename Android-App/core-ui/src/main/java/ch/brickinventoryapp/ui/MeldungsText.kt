package ch.brickinventoryapp.ui

import androidx.compose.runtime.Composable
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import ch.brickinventoryapp.model.ui.Meldung

/**
 * For screens: the string of a [Meldung] in the language the composition
 * carries. A value that is itself a message is built first, so one string
 * can embed another. The snackbar builds its string outside the
 * composition (AppNavigation, via LanguageManager).
 */
@Composable
fun Meldung.satz(): String = when (this) {
    is Meldung.Text -> text
    is Meldung.Resource ->
        if (werte.isEmpty()) stringResource(id) else stringResource(id, *werte.map { w -> if (w is Meldung) w.satz() else w }.toTypedArray())
    is Meldung.Menge -> pluralStringResource(id, anzahl, *werte.map { w -> if (w is Meldung) w.satz() else w }.toTypedArray())
}
