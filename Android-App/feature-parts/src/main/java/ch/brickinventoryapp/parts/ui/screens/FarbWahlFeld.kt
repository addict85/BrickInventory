package ch.brickinventoryapp.parts.ui.screens

import ch.brickinventoryapp.ui.theme.colorFromHex
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
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
import ch.brickinventoryapp.resources.R
import ch.brickinventoryapp.model.domain.ColorView
import ch.brickinventoryapp.model.domain.OHNE_FARBE
import ch.brickinventoryapp.model.ui.farbName
import ch.brickinventoryapp.model.ui.withoutNoColor
import ch.brickinventoryapp.ui.theme.Abstaende
import ch.brickinventoryapp.ui.theme.Formen

/**
 * Choose the color of a manually entered part — for correcting it if it
 * was not taken over correctly on import.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
internal fun FarbWahlFeld(
    farben: List<ColorView>,
    aktuell: Int,
    aktuellerName: String?,
    currentHex: String?,
    onWahl: (ColorView) -> Unit,
    modifier: Modifier = Modifier,
) {
    var offen by rememberSaveable { mutableStateOf(false) }
    // What the list knows about today's color wins against the
    // stock row: there the name is the one sent along at entry time,
    // and it can be older than the catalog. Without either, no "Farbe 5": the
    // number means nothing to anyone.
    val noColor = stringResource(R.string.parts_no_color)
    val name = farbName(farben, aktuell, aktuellerName, noColor)
        ?: stringResource(R.string.parts_color_unknown)
    val hex = if (aktuell == OHNE_FARBE) null else farben.firstOrNull { it.id == aktuell }?.hex ?: currentHex
    // "Keine Farbe" is offered as a choice, so that a wrongly taken-over color can also be removed.
    val wahl = listOf(ColorView(OHNE_FARBE, noColor, null)) + withoutNoColor(farben)

    ExposedDropdownMenuBox(
        expanded = offen && farben.isNotEmpty(),
        onExpandedChange = { if (farben.isNotEmpty()) offen = it },
        modifier = modifier,
    ) {
        OutlinedTextField(
            value = name,
            onValueChange = {},
            readOnly = true,
            leadingIcon = { FarbPoint(hex, Modifier.padding(start = Abstaende.mittel)) },
            trailingIcon = { ExposedDropdownMenuDefaults.TrailingIcon(expanded = offen) },
            modifier = Modifier.fillMaxWidth()
                .menuAnchor(ExposedDropdownMenuAnchorType.PrimaryNotEditable, enabled = true),
            singleLine = true,
            // Like the detail page's other values, not smaller.
            textStyle = MaterialTheme.typography.bodyMedium,
            shape = Formen.feld,
        )
        ExposedDropdownMenu(expanded = offen && farben.isNotEmpty(), onDismissRequest = { offen = false }) {
            wahl.forEach { c ->
                DropdownMenuItem(
                    text = { Text(c.name) },
                    leadingIcon = { FarbPoint(c.hex) },
                    onClick = {
                        offen = false
                        // The same color again is not a change — and the
                        // server would reject it too. Aborting here
                        // saves the request AND reloading the screen.
                        if (c.id != aktuell) onWahl(c)
                    },
                )
            }
        }
    }
}

/** Der Farbpunkt. Ein unlesbarer Hex-Wert ergibt KEINEN Punkt, keinen falschen. */
@Composable
private fun FarbPoint(hex: String?, modifier: Modifier = Modifier) {
    val farbe = colorFromHex(hex) ?: return
    Box(modifier.size(14.dp).clip(CircleShape).background(farbe))
}
