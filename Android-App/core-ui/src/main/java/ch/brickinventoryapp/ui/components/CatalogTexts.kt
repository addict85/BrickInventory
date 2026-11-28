package ch.brickinventoryapp.ui.components

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.intl.LocaleList
import ch.brickinventoryapp.resources.R
import ch.brickinventoryapp.uistate.CategoryGerman
import ch.brickinventoryapp.uistate.ColorGerman

/** Is the UI in German? Rebrickable's catalog data never is. */
@Composable
private fun german(): Boolean = LocalConfiguration.current.locales[0].language == "de"

/**
 * Color names in the app's language, as in the web app (colorName): „Trans-Klar“
 * instead of „Trans-Clear“. As a function, so lists outside the composition too
 * (filter entries in remember) get translated.
 */
@Composable
fun colorTranslator(): (String) -> String =
    if (german()) ColorGerman::translate else { name -> name }

/** Part categories in the app's language, like the colors next to them („Steine“ instead of „Bricks“). */
@Composable
fun categoryTranslator(): (String) -> String =
    if (german()) CategoryGerman::translate else { name -> name }

/**
 * Part and figure names stay in English: the server supplies none in German,
 * and a word-for-word translation („Fliese 1 x 2 mit Nut“) would miss the names
 * under which a part is searched for on BrickLink. They're tagged as
 * English, so TalkBack pronounces them in English instead of spelling them out in German.
 */
@Composable
fun catalogName(name: String): AnnotatedString =
    if (german()) AnnotatedString(name, SpanStyle(localeList = LocaleList("en"))) else AnnotatedString(name)

/**
 * „Name auf Englisch“ under a catalog name, only in a German UI: otherwise an English name
 * among German labels reads like a missing translation. TalkBack hears it via [catalogName].
 */
@Composable
fun CatalogNameHint(modifier: Modifier = Modifier) {
    if (!german()) return
    Text(stringResource(R.string.catalog_name_english), modifier,
        style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
}
