package ch.brickinventoryapp.parts.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ExposedDropdownMenu
import androidx.compose.material3.ExposedDropdownMenuAnchorType
import androidx.compose.material3.ExposedDropdownMenuBox
import androidx.compose.material3.ExposedDropdownMenuDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import ch.brickinventoryapp.model.domain.ColorView
import ch.brickinventoryapp.model.domain.WITHOUT_COLOR
import ch.brickinventoryapp.resources.R
import ch.brickinventoryapp.ui.theme.Shapes
import ch.brickinventoryapp.ui.theme.Spacing
import ch.brickinventoryapp.ui.theme.colorFromHex
import ch.brickinventoryapp.uistate.colorName
import ch.brickinventoryapp.uistate.withoutNoColor

/**
 * Choose the color of a manually entered part — for correcting it if it
 * was not taken over correctly on import.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
internal fun ColorChoiceField(
    colors: List<ColorView>,
    current: Int,
    currentName: String?,
    currentHex: String?,
    onChoice: (ColorView) -> Unit,
    modifier: Modifier = Modifier,
) {
    var open by rememberSaveable { mutableStateOf(false) }
    // What the list knows about today's color wins against the
    // stock row: there the name is the one sent along at entry time,
    // and it can be older than the catalog. Without either, no "Farbe 5": the
    // number means nothing to anyone.
    val noColor = stringResource(R.string.parts_no_color)
    val name = colorName(colors, current, currentName, noColor)
        ?: stringResource(R.string.parts_color_unknown)
    val hex = if (current == WITHOUT_COLOR) null else colors.firstOrNull { it.id == current }?.hex ?: currentHex
    // "Keine Farbe" is offered as a choice, so that a wrongly taken-over color can also be removed.
    val choice = listOf(ColorView(WITHOUT_COLOR, noColor, null)) + withoutNoColor(colors)

    ExposedDropdownMenuBox(
        expanded = open && colors.isNotEmpty(),
        onExpandedChange = { if (colors.isNotEmpty()) open = it },
        modifier = modifier,
    ) {
        OutlinedTextField(
            value = name,
            onValueChange = {},
            readOnly = true,
            leadingIcon = { ColorPoint(hex, Modifier.padding(start = Spacing.medium)) },
            trailingIcon = { ExposedDropdownMenuDefaults.TrailingIcon(expanded = open) },
            modifier = Modifier.fillMaxWidth()
                .menuAnchor(ExposedDropdownMenuAnchorType.PrimaryNotEditable, enabled = true),
            singleLine = true,
            // Like the detail page's other values, not smaller.
            textStyle = MaterialTheme.typography.bodyMedium,
            shape = Shapes.field,
        )
        ExposedDropdownMenu(expanded = open && colors.isNotEmpty(), onDismissRequest = { open = false }) {
            choice.forEach { c ->
                DropdownMenuItem(
                    text = { Text(c.name) },
                    leadingIcon = { ColorPoint(c.hex) },
                    onClick = {
                        open = false
                        // The same color again is not a change — and the
                        // server would reject it too. Aborting here
                        // saves the request AND reloading the screen.
                        if (c.id != current) onChoice(c)
                    },
                )
            }
        }
    }
}

/** Der Farbpunkt. Ein unlesbarer Hex-Wert ergibt KEINEN Punkt, keinen falschen. */
@Composable
private fun ColorPoint(hex: String?, modifier: Modifier = Modifier) {
    val color = colorFromHex(hex) ?: return
    Box(modifier.size(14.dp).clip(CircleShape).background(color))
}
