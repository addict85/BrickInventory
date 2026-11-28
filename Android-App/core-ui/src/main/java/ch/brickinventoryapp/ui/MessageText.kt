package ch.brickinventoryapp.ui

import androidx.compose.runtime.Composable
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import ch.brickinventoryapp.model.text.Message

/**
 * For screens: the string of a [Message] in the language the composition
 * carries. A value that is itself a message is built first, so one string
 * can embed another. The snackbar builds its string outside the
 * composition (AppNavigation, via LanguageManager).
 */
@Composable
fun Message.sentence(): String = when (this) {
    is Message.Text -> text
    is Message.Resource ->
        if (values.isEmpty()) stringResource(id) else stringResource(id, *values.map { w -> if (w is Message) w.sentence() else w }.toTypedArray())
    is Message.Quantity -> pluralStringResource(id, count, *values.map { w -> if (w is Message) w.sentence() else w }.toTypedArray())
}
