package ch.brickinventoryapp.ui.components

import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.size
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Check
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ExposedDropdownMenuAnchorType
import androidx.compose.material3.ExposedDropdownMenuBox
import androidx.compose.material3.ExposedDropdownMenuDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import ch.brickinventoryapp.ui.theme.Formen

/**
 * A choice from a longer list (language, currency, theme, lock timeout) as a field with
 * a menu: chips for this read like filters and filled several lines at 200% text size.
 * The field names the choice, the menu shows it with a checkmark.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun <T> SelectionField(
    beschriftung: String,
    optionen: List<Pair<T, String>>,
    gewaehlt: T,
    onWahl: (T) -> Unit,
    modifier: Modifier = Modifier,
    /** Off, when the choice currently has no effect; the caller says why next to it. */
    enabled: Boolean = true,
) {
    var offen by rememberSaveable { mutableStateOf(false) }
    val text = optionen.firstOrNull { it.first == gewaehlt }?.second.orEmpty()
    ExposedDropdownMenuBox(expanded = offen && enabled, onExpandedChange = { if (enabled) offen = it }, modifier = modifier) {
        OutlinedTextField(
            value = text,
            onValueChange = {},
            readOnly = true,
            enabled = enabled,
            label = { Text(beschriftung) },
            trailingIcon = { ExposedDropdownMenuDefaults.TrailingIcon(expanded = offen) },
            singleLine = true,
            shape = Formen.feld,
            modifier = Modifier.menuAnchor(ExposedDropdownMenuAnchorType.PrimaryNotEditable, enabled).fillMaxWidth(),
        )
        ExposedDropdownMenu(expanded = offen && enabled, onDismissRequest = { offen = false }) {
            optionen.forEach { (wert, name) ->
                DropdownMenuItem(
                    text = { Text(name) },
                    onClick = { offen = false; if (wert != gewaehlt) onWahl(wert) },
                    leadingIcon = {
                        if (wert == gewaehlt) Icon(Icons.Default.Check, null, Modifier.size(withFont(18.dp)))
                        else Spacer(Modifier.size(withFont(18.dp)))
                    },
                    modifier = Modifier.semantics { selected = wert == gewaehlt },
                )
            }
        }
    }
}
