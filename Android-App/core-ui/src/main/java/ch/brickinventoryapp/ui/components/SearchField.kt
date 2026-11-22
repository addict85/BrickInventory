package ch.brickinventoryapp.ui.components

import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Clear
import androidx.compose.material.icons.filled.Search
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import ch.brickinventoryapp.resources.R
import ch.brickinventoryapp.ui.theme.Spacing
import ch.brickinventoryapp.ui.theme.Shapes
import ch.brickinventoryapp.model.ui.ListView

/**
 * Cards/table switch as two chips: with two possibilities, a
 * dropdown menu would be one click too many, and the choice is visible without opening it.
 */
@Composable
fun ViewToggle(
    current: ListView,
    onSwitch: (ListView) -> Unit,
    modifier: Modifier = Modifier,
) {
    SegmentChoice(
        options = listOf(
            ListView.CARDS to stringResource(R.string.view_cards),
            ListView.TABLE to stringResource(R.string.view_table),
        ),
        chosen = current,
        onChoice = onSwitch,
        modifier = modifier,
    )
}

/**
 * The search field for gallery, parts, minifigs and catalog. One implementation, so
 * the clear button is also named the same everywhere: `cd_search_clear` describes the
 * effect — „Löschen“ would have read TalkBack users the word for „destroy the
 * inventory“.
 */
@Composable
fun SearchField(
    value: String,
    onValue: (String) -> Unit,
    placeholder: String,
    modifier: Modifier = Modifier,
) {
    // With normal text size, one line: a wrapping placeholder made the field twice
    // as tall as the filter button next to it. With large text it wraps instead of
    // cutting off at „Nummer oder…“.
    val rows = if (largeFont()) PLACEHOLDER_ROWS_LARGE else 1
    OutlinedTextField(
        value = value,
        onValueChange = onValue,
        placeholder = { Text(placeholder, maxLines = rows, overflow = TextOverflow.Ellipsis) },
        leadingIcon = { Icon(Icons.Default.Search, null, Modifier.size(withFont(20.dp))) },
        trailingIcon = {
            if (value.isNotEmpty()) {
                WithTooltip(stringResource(R.string.cd_search_clear)) {
                    IconButton(onClick = { onValue("") }) {
                        Icon(Icons.Default.Clear, stringResource(R.string.cd_search_clear))
                    }
                }
            }
        },
        // The placeholder disappears on the first keystroke; the field's name stays.
        modifier = modifier.fillMaxWidth().padding(horizontal = 14.dp, vertical = Spacing.small)
            .semantics { contentDescription = placeholder },
        singleLine = true,
        shape = Shapes.card,
    )
}

private const val PLACEHOLDER_ROWS_LARGE = 3
