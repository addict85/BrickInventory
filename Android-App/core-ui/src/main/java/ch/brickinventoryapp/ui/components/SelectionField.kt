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
import ch.brickinventoryapp.ui.theme.Shapes

/**
 * A choice from a longer list (language, currency, theme, lock timeout) as a field with
 * a menu: chips for this read like filters and filled several lines at 200% text size.
 * The field names the choice, the menu shows it with a checkmark.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun <T> SelectionField(
    label: String,
    options: List<Pair<T, String>>,
    chosen: T,
    onChoice: (T) -> Unit,
    modifier: Modifier = Modifier,
    /** Off, when the choice currently has no effect; the caller says why next to it. */
    enabled: Boolean = true,
) {
    var open by rememberSaveable { mutableStateOf(false) }
    val text = options.firstOrNull { it.first == chosen }?.second.orEmpty()
    ExposedDropdownMenuBox(expanded = open && enabled, onExpandedChange = { if (enabled) open = it }, modifier = modifier) {
        OutlinedTextField(
            value = text,
            onValueChange = {},
            readOnly = true,
            enabled = enabled,
            label = { Text(label) },
            trailingIcon = { ExposedDropdownMenuDefaults.TrailingIcon(expanded = open) },
            singleLine = true,
            shape = Shapes.field,
            modifier = Modifier.menuAnchor(ExposedDropdownMenuAnchorType.PrimaryNotEditable, enabled).fillMaxWidth(),
        )
        ExposedDropdownMenu(expanded = open && enabled, onDismissRequest = { open = false }) {
            options.forEach { (value, name) ->
                DropdownMenuItem(
                    text = { Text(name) },
                    onClick = { open = false; if (value != chosen) onChoice(value) },
                    leadingIcon = {
                        if (value == chosen) Icon(Icons.Default.Check, null, Modifier.size(withFont(18.dp)))
                        else Spacer(Modifier.size(withFont(18.dp)))
                    },
                    modifier = Modifier.semantics { selected = value == chosen },
                )
            }
        }
    }
}
